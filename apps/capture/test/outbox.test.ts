import { describe, expect, it } from "vitest";
import { sendJob, type QueuedJob } from "../src/shared/outbox-core";
import { assessQuality } from "../src/images";

const job: QueuedJob = {
  client_request_id: "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c",
  goal: "RC car",
  photos: [new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })],
  queued_at: "2026-10-21T00:00:00Z",
};

function deps(responses: (Response | Error)[], tickets: (string | null)[] = ["t1", "t2", "t3"]) {
  const sent: FormData[] = [];
  const headers: Headers[] = [];
  return {
    sent,
    headers,
    deps: {
      apiUrl: "https://api.test/",
      getToken: async () => "jwt",
      takeTicket: async () => tickets.shift() ?? null,
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        sent.push(init!.body as FormData);
        headers.push(new Headers(init!.headers));
        const r = responses.shift()!;
        if (r instanceof Error) throw r;
        return r;
      }) as typeof fetch,
    },
  };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("sendJob", () => {
  it("uploads with a ticket and the idempotency key", async () => {
    const d = deps([json(202, { job_id: "j1", duplicate: false, quota: { limit: 10, used: 3, remaining: 7, resets_at: "x" } })]);
    const out = await sendJob(job, d.deps);
    expect(out).toMatchObject({ kind: "sent", job_id: "j1" });
    expect(d.sent[0]!.get("upload_ticket")).toBe("t1");
    expect(d.sent[0]!.get("turnstile_token")).toBeNull();
    expect(d.sent[0]!.get("client_request_id")).toBe(job.client_request_id);
    expect(d.sent[0]!.getAll("photos")).toHaveLength(1);
    expect(d.headers[0]!.get("authorization")).toBe("Bearer jwt");
  });

  it("moves to the next ticket when one was already used", async () => {
    const d = deps([json(403, { error: { code: "ticket_invalid" } }), json(202, { job_id: "j2" })]);
    expect(await sendJob(job, d.deps)).toMatchObject({ kind: "sent", job_id: "j2" });
    expect(d.sent.map((f) => f.get("upload_ticket"))).toEqual(["t1", "t2"]);
  });

  it("asks for Turnstile when no ticket is left, and uses a fresh token if given", async () => {
    expect(await sendJob(job, deps([], []).deps)).toEqual({ kind: "no_ticket" });
    const d = deps([json(202, { job_id: "j3" })], []);
    await sendJob(job, { ...d.deps, turnstileToken: "cf-token" });
    expect(d.sent[0]!.get("turnstile_token")).toBe("cf-token");
  });

  it.each([
    [new TypeError("offline"), "retry"],
    [json(503, {}), "retry"],
    [json(429, { error: { code: "rate_limited" } }), "retry"],
    [json(401, { error: { code: "unauthorized" } }), "auth"],
    [json(429, { error: { code: "quota_exceeded" } }), "failed"],
    [json(415, { error: { code: "heic_not_converted" } }), "failed"],
  ])("classifies %s as %s", async (response, kind) => {
    expect((await sendJob(job, deps([response]).deps)).kind).toBe(kind);
  });

  it("reports signed-out without touching the network", async () => {
    const d = deps([]);
    expect(await sendJob(job, { ...d.deps, getToken: async () => null })).toEqual({ kind: "auth" });
    expect(d.sent).toHaveLength(0);
  });
});

describe("photo quality hint", () => {
  const img = (w: number, h: number, f: (x: number, y: number) => number) => {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = f(x, y);
        a.set([v, v, v, 255], (y * w + x) * 4);
      }
    return a;
  };
  it("flags dark and flat (blurry) images, accepts detailed ones", () => {
    expect(assessQuality(img(64, 64, () => 10), 64, 64)).toBe("too_dark");
    expect(assessQuality(img(64, 64, () => 128), 64, 64)).toBe("blurry");
    expect(assessQuality(img(64, 64, (x, y) => ((x + y) % 2 ? 230 : 60)), 64, 64)).toBeNull();
  });
});
