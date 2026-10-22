import { describe, expect, it } from "vitest";
import { JobDetailResponse, type JobDetailResponse as Detail } from "@partspilot/shared";
import { api, enabled, photo, testUser, TURNSTILE_TEST_TOKEN, waitFor } from "../support/local.js";

/**
 * Real stack: local Supabase (Postgres/PostgREST/Auth/Storage) + `wrangler dev --env local`
 * (Queues simulated, AI_PROVIDER=mock). Run: pnpm --filter @partspilot/e2e test:local
 */
describe.runIf(enabled)("pipeline on the local stack", () => {
  it("photo + goal → detected parts → validated plan, under 60 s", async () => {
    const user = await testUser("pipeline");
    const form = new FormData();
    form.set("client_request_id", crypto.randomUUID());
    form.set("goal", "Can I build an RC car?");
    form.set("turnstile_token", TURNSTILE_TEST_TOKEN);
    form.append("photos", new Blob([photo() as BlobPart], { type: "image/jpeg" }), "pile.jpg");

    const t0 = Date.now();
    const created = await api("/v1/jobs", user.token, { method: "POST", body: form });
    expect(created.status).toBe(202);
    const sentMs = Date.now() - t0;
    const { job_id, quota } = (await created.json()) as { job_id: string; quota: { remaining: number } };
    expect(quota.remaining).toBe(9);
    expect(sentMs).toBeLessThan(2000);

    const detail = await waitFor<Detail>(async () => {
      const res = await api(`/v1/jobs/${job_id}`, user.token);
      const body = JobDetailResponse.parse(await res.json());
      return body.job.status === "processing" ? null : body;
    }, 60_000);
    const totalMs = Date.now() - t0;

    expect(detail.job.status).toBe("ready");
    expect(totalMs).toBeLessThan(60_000);
    expect(detail.parts.filter((p) => !p.duplicate).map((p) => p.name)).toEqual(
      expect.arrayContaining(["Arduino Uno R3", "L298N Dual H-Bridge Motor Driver Module", "HC-05 Bluetooth Serial Module"]),
    );
    expect(detail.photos[0]!.url).toContain("token=");
    const plan = detail.result!.plans[0]!;
    expect(plan.validation.passed).toBe(true);
    expect(["yes", "yes_missing"]).toContain(plan.verdict);
    expect(plan.diagram?.wires.length).toBeGreaterThan(5);
    expect(plan.code?.source.length).toBeGreaterThan(100);

    const img = await fetch(detail.photos[0]!.url);
    expect(img.status).toBe(200);
    const bytes = Buffer.from(await img.arrayBuffer());
    expect(bytes.includes(Buffer.from("GPS 51.5007N"))).toBe(false); // EXIF stripped before storage
    console.log(`sent in ${sentMs} ms, ready in ${totalMs} ms; verdict ${plan.verdict}; missing ${plan.missing.map((m) => m.name).join(", ")}`);
  }, 90_000);
});
