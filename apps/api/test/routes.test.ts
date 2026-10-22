import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { CATALOG, makeDeps, USER_A, USER_B } from "./support/fakes.js";
import { heic, includes, jpeg, png, SECRET } from "./support/images.js";

const REQ = (n: number) => `9a9a9a9a-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(over: Parameters<typeof makeDeps>[0] = {}) {
  const ctx = makeDeps(over);
  const app = createApp(() => ctx.deps);
  const call = (path: string, init: RequestInit & { token?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token !== null) headers.set("authorization", `Bearer ${init.token ?? "token-a"}`);
    headers.set("cf-connecting-ip", "203.0.113.7");
    return app.request(path, { ...init, headers });
  };
  return { ...ctx, app, call };
}

function jobForm(opts: { req?: string; photos?: Uint8Array[]; goal?: string; turnstile?: string; ticket?: string } = {}) {
  const f = new FormData();
  f.set("client_request_id", opts.req ?? REQ(1));
  f.set("goal", opts.goal ?? "Can I build an RC car?");
  if (opts.ticket) f.set("upload_ticket", opts.ticket);
  else f.set("turnstile_token", opts.turnstile ?? "good-turnstile");
  for (const [i, p] of (opts.photos ?? [jpeg()]).entries()) f.append("photos", new Blob([p as BlobPart], { type: "image/jpeg" }), `p${i}.jpg`);
  return f;
}

afterEach(() => vi.restoreAllMocks());

describe("authentication on every route", () => {
  const routes: [string, string][] = [
    ["GET", "/v1/me"],
    ["GET", "/v1/quota"],
    ["POST", "/v1/upload-tickets"],
    ["POST", "/v1/jobs"],
    ["GET", "/v1/jobs"],
    ["GET", `/v1/jobs/${REQ(9)}`],
    ["PUT", `/v1/jobs/${REQ(9)}/parts`],
    ["DELETE", `/v1/jobs/${REQ(9)}`],
    ["GET", "/v1/catalog/search?q=uno"],
    ["GET", "/v1/inventory"],
    ["PUT", "/v1/inventory/arduino-uno-r3"],
    ["POST", "/v1/inventory/plan"],
    ["GET", "/v1/does-not-exist"],
  ];
  it.each(routes)("%s %s → 401 without a valid token", async (method, path) => {
    const { call } = setup();
    expect((await call(path, { method, token: null })).status).toBe(401);
    expect((await call(path, { method, token: "forged" })).status).toBe(401);
  });

  it("rate limits per IP before auth and per user after", async () => {
    const s = setup();
    s.limiters.ip.deny.add("ip:203.0.113.7");
    expect((await s.call("/v1/me", { token: null })).status).toBe(429);
    const t = setup();
    t.limiters.user.deny.add(`user:${USER_A}`);
    const res = await t.call("/v1/me");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});

describe("CORS and headers", () => {
  it("allows only configured origins", async () => {
    const { app } = setup();
    const pre = (origin: string) =>
      app.request("/v1/jobs", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization" },
      });
    expect((await pre("http://tauri.localhost")).headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    expect((await pre("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sends no-store and nosniff on API responses", async () => {
    const { call } = setup();
    const res = await call("/v1/quota");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("POST /v1/jobs", () => {
  it("stores sanitized photos, enqueues detection and reports quota", async () => {
    const { call, photos, queue, repo } = setup();
    const res = await call("/v1/jobs", { method: "POST", body: jobForm({ photos: [jpeg(), png()] }) });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { job_id: string; duplicate: boolean; quota: { remaining: number } };
    expect(body).toMatchObject({ duplicate: false, quota: { remaining: 9 } });
    expect(queue).toEqual([{ type: "detect", job_id: body.job_id }]);
    const stored = [...photos.objects.entries()];
    expect(stored.map(([p]) => p)).toEqual([`${USER_A}/${body.job_id}/0.jpg`, `${USER_A}/${body.job_id}/1.png`]);
    for (const [, o] of stored) expect(includes(o.bytes, SECRET)).toBe(false);
    const job = await repo.getJob(body.job_id);
    expect(job?.photo_meta.map((m) => m.mime)).toEqual(["image/jpeg", "image/png"]);
    expect(job?.image_set_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent for offline replays and does not spend a second ticket", async () => {
    const { call, repo, queue } = setup();
    const [ticket] = await repo.issueTickets(USER_A, 3, 3600);
    const first = await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(2), ticket: ticket!.id }) });
    expect(first.status).toBe(202);
    const replay = await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(2), ticket: ticket!.id }) });
    expect(replay.status).toBe(202);
    expect(((await replay.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(queue.length).toBe(1);
    expect(await repo.quotaUsed(USER_A)).toBe(1);
  });

  it("rejects used or foreign tickets and failed Turnstile", async () => {
    const { call, repo } = setup();
    const [ticketB] = await repo.issueTickets(USER_B, 1, 3600);
    expect((await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(3), ticket: ticketB!.id }) })).status).toBe(403);
    const bad = await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(4), turnstile: "bot" }) });
    expect(bad.status).toBe(403);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("turnstile_failed");
    expect(await repo.quotaUsed(USER_A)).toBe(0);
  });

  it("enforces 10 jobs/day and releases the ticket when over quota", async () => {
    const { call, repo } = setup();
    repo.usage.set(USER_A, 10);
    const [ticket] = await repo.issueTickets(USER_A, 1, 3600);
    const res = await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(5), ticket: ticket!.id }) });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("quota_exceeded");
    expect(Number(res.headers.get("retry-after"))).toBe(12 * 3600);
    expect(repo.tickets.get(ticket!.id)?.used).toBe(false);
  });

  it.each([
    ["HEIC", [heic()], 415, "heic_not_converted"],
    ["a non-image", [new TextEncoder().encode("MZ executable")], 415, "unsupported_media_type"],
    ["5 photos", [jpeg(), jpeg(), jpeg(), jpeg(), jpeg()], 400, "too_many_photos"],
    ["a 10 MB+ photo", [jpeg(1024, 768, { padTo: 10 * 1024 * 1024 + 10 })], 413, "payload_too_large"],
  ])("rejects %s", async (_, photosIn, status, code) => {
    const { call, repo } = setup();
    const res = await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(6), photos: photosIn }) });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(await repo.quotaUsed(USER_A)).toBe(0);
  });

  it("refunds quota when storage fails", async () => {
    const { call, repo, photos } = setup();
    photos.failPut = true;
    const res = await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(7) }) });
    expect(res.status).toBe(500);
    expect(await repo.quotaUsed(USER_A)).toBe(0);
  });

  it("never logs the goal, labels or tokens", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => void lines.push(String(s)));
    const { call } = setup();
    await call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(8), goal: "build my secret zebra project" }) });
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).not.toContain("zebra");
      expect(l).not.toContain("good-turnstile");
      expect(l).not.toContain("token-a");
    }
  });
});

describe("upload tickets", () => {
  it("issues tickets only after Turnstile", async () => {
    const { call } = setup();
    const bad = await call("/v1/upload-tickets", { method: "POST", body: JSON.stringify({ turnstile_token: "bot" }) });
    expect(bad.status).toBe(403);
    const ok = await call("/v1/upload-tickets", { method: "POST", body: JSON.stringify({ turnstile_token: "good-turnstile" }) });
    expect(((await ok.json()) as { tickets: unknown[] }).tickets).toHaveLength(3);
  });
});

describe("jobs read/write", () => {
  async function createdJob(s: ReturnType<typeof setup>) {
    const res = await s.call("/v1/jobs", { method: "POST", body: jobForm({ req: REQ(20) }) });
    const { job_id } = (await res.json()) as { job_id: string };
    const job = s.repo.jobs.get(job_id)!;
    Object.assign(job, { stage: "awaiting_confirmation", status: "needs_check" });
    await s.repo.insertJobParts([
      {
        job_id,
        user_id: USER_A,
        image_index: 0,
        bbox: { x: 0, y: 0, w: 0.5, h: 0.5 },
        label: "blue board",
        visible_text: ["L298N"],
        detection_confidence: 0.9,
        candidates: [{ part_id: "l298n-motor-driver", name: CATALOG[1]!.name, score: 0.7 }],
        part_id: "l298n-motor-driver",
        confidence: 0.7,
        quantity: 1,
        status: "needs_check",
        duplicate: false,
      },
      {
        job_id,
        user_id: USER_A,
        image_index: 0,
        bbox: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
        label: "coin",
        visible_text: [],
        detection_confidence: 0.4,
        candidates: [],
        part_id: null,
        confidence: 0,
        quantity: 1,
        status: "needs_check",
        duplicate: false,
      },
    ]);
    return job_id;
  }

  it("hides other users' jobs", async () => {
    const s = setup();
    const id = await createdJob(s);
    expect((await s.call(`/v1/jobs/${id}`, { token: "token-b" })).status).toBe(404);
    expect((await s.call(`/v1/jobs/${id}`, { method: "DELETE", token: "token-b" })).status).toBe(404);
    const list = (await (await s.call("/v1/jobs", { token: "token-b" })).json()) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  it("returns detail with 5-minute signed photo URLs", async () => {
    const s = setup();
    const id = await createdJob(s);
    const res = await s.call(`/v1/jobs/${id}`);
    const body = (await res.json()) as { photos: { url: string; expires_at: string }[]; parts: { name: string | null }[] };
    expect(body.photos[0]!.url).toContain("ttl=300");
    expect(body.photos[0]!.expires_at).toBe("2026-10-21T12:05:00.000Z");
    expect(body.parts.map((p) => p.name)).toEqual([CATALOG[1]!.name, null]);
    const list = (await (await s.call("/v1/jobs")).json()) as { items: { thumbnail_url: string }[] };
    expect(list.items[0]!.thumbnail_url).toContain("ttl=300");
  });

  it("confirms/corrects parts, bumps plan_version and re-plans", async () => {
    const s = setup();
    const id = await createdJob(s);
    const [driver] = await s.repo.listJobParts(id);
    const res = await s.call(`/v1/jobs/${id}/parts`, {
      method: "PUT",
      body: JSON.stringify({
        plan_version: 0,
        parts: [
          { id: driver!.id, part_id: "l298n-motor-driver", quantity: 1 },
          { part_id: "tt-dc-gear-motor", quantity: 2 },
        ],
      }),
    });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { job: { plan_version: number } }).job.plan_version).toBe(1);
    const parts = await s.repo.listJobParts(id);
    expect(parts.map((p) => [p.label, p.status])).toEqual([
      ["blue board", "confirmed"],
      ["coin", "removed"],
      ["TT DC Gear Motor 3-6V", "added"],
    ]);
    expect(s.queue.at(-1)).toEqual({ type: "plan", job_id: id, plan_version: 1 });
    expect(s.repo.appliedInventory).toContain(id);

    const stale = await s.call(`/v1/jobs/${id}/parts`, {
      method: "PUT",
      body: JSON.stringify({ plan_version: 0, parts: [] }),
    });
    expect(stale.status).toBe(409);
  });

  it("rejects unknown catalog parts", async () => {
    const s = setup();
    const id = await createdJob(s);
    const res = await s.call(`/v1/jobs/${id}/parts`, {
      method: "PUT",
      body: JSON.stringify({ plan_version: 0, parts: [{ part_id: "flux-capacitor", quantity: 1 }] }),
    });
    expect(res.status).toBe(422);
  });

  it("deletes the job and its photos", async () => {
    const s = setup();
    const id = await createdJob(s);
    expect(s.photos.objects.size).toBe(1);
    expect((await s.call(`/v1/jobs/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(s.photos.objects.size).toBe(0);
    expect(s.repo.jobs.has(id)).toBe(false);
  });
});

describe("inventory", () => {
  it("edits items and plans from inventory without photos", async () => {
    const s = setup();
    await s.call("/v1/inventory/arduino-uno-r3", { method: "PUT", body: JSON.stringify({ quantity: 2 }) });
    const inv = (await (await s.call("/v1/inventory")).json()) as { items: { part_id: string; quantity: number }[] };
    expect(inv.items).toEqual([expect.objectContaining({ part_id: "arduino-uno-r3", quantity: 2 })]);
    expect((await s.call("/v1/inventory/flux-capacitor", { method: "PUT", body: JSON.stringify({ quantity: 1 }) })).status).toBe(422);

    const res = await s.call("/v1/inventory/plan", { method: "POST", body: JSON.stringify({ client_request_id: REQ(30) }) });
    expect(res.status).toBe(202);
    const { job_id } = (await res.json()) as { job_id: string };
    expect(s.queue.at(-1)).toEqual({ type: "plan", job_id, plan_version: 0 });
    expect((await s.repo.listJobParts(job_id)).map((p) => [p.part_id, p.quantity, p.status])).toEqual([
      ["arduino-uno-r3", 2, "confirmed"],
    ]);
  });
});
