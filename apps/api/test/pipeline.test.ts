import { describe, expect, it } from "vitest";
import type { JobResultPayload } from "@partspilot/shared";
import { handleDeadLetters, handleJobMessages, type QueueMessageLike } from "../src/pipeline/consumer.js";
import { cleanupExpired } from "../src/pipeline/cleanup.js";
import { markCrossPhotoDuplicates, runDetect, runPlan, type PipelineDeps } from "../src/pipeline/stages.js";
import type { AiEngine } from "../src/pipeline/engine.js";
import { fakeEngine, FakePhotos, FakeRepo, USER_A } from "./support/fakes.js";

async function seedJob(repo: FakeRepo, photos: FakePhotos, n = 1) {
  const { jobId } = await repo.createJob({
    userId: USER_A,
    clientRequestId: crypto.randomUUID(),
    source: "photo",
    goal: "RC car",
    photoCount: n,
    limit: 10,
  });
  const paths = Array.from({ length: n }, (_, i) => `${USER_A}/${jobId}/${i}.jpg`);
  for (const p of paths) await photos.put(p, new Uint8Array([1, 2, 3]), "image/jpeg");
  await repo.updateJob(jobId!, {
    photo_paths: paths,
    photo_meta: paths.map((_, index) => ({ index, width: 1000, height: 800, bytes: 3, sha256: "x", mime: "image/jpeg" })),
    image_set_hash: `hash-${jobId}`,
  });
  return jobId!;
}

function deps(engine: AiEngine = fakeEngine()) {
  const repo = new FakeRepo();
  const photos = new FakePhotos();
  const queue: unknown[] = [];
  const d: PipelineDeps = { repo, photos, engine, enqueue: async (m) => void queue.push(m) };
  return { d, repo, photos, queue };
}

const msg = (body: unknown, attempts = 1) => {
  const m = { body, attempts, acked: false, retried: undefined as number | undefined } as QueueMessageLike & {
    acked: boolean;
    retried?: number;
  };
  m.ack = () => void (m.acked = true);
  m.retry = (o) => void (m.retried = o?.delaySeconds ?? 0);
  return m;
};

describe("detect stage", () => {
  it("auto-accepts confident matches and enqueues planning", async () => {
    const { d, repo, photos, queue } = deps();
    const id = await seedJob(repo, photos);
    await runDetect(id, d);
    const job = await repo.getJob(id);
    expect(job).toMatchObject({ stage: "planning", status: "processing" });
    expect((await repo.listJobParts(id)).map((p) => p.status)).toEqual(["auto"]);
    expect(repo.appliedInventory).toEqual([id]);
    expect(queue).toEqual([{ type: "plan", job_id: id, plan_version: 0 }]);
  });

  it("asks the user when any match is below 0.85", async () => {
    const engine = fakeEngine({
      match: async (items) => items.map(() => [{ part_id: "l298n-motor-driver", name: "L298N", score: 0.62 }]),
    });
    const { d, repo, photos, queue } = deps(engine);
    const id = await seedJob(repo, photos);
    await runDetect(id, d);
    expect(await repo.getJob(id)).toMatchObject({ status: "needs_check", stage: "awaiting_confirmation" });
    expect((await repo.getJob(id))?.summary?.needs_check_count).toBe(1);
    expect(queue).toEqual([]);
    expect(repo.appliedInventory).toEqual([]);
  });

  it("reuses cached detections for the same image set", async () => {
    let calls = 0;
    const base = fakeEngine();
    const { d, repo, photos } = deps({ ...base, detect: async (imgs) => (calls++, base.detect(imgs)) });
    const id = await seedJob(repo, photos);
    await runDetect(id, d);
    await repo.updateJob(id, { stage: "queued" });
    await runDetect(id, d);
    expect(calls).toBe(1);
  });

  it("never reuses results produced by a different model", async () => {
    let calls = 0;
    const base = fakeEngine();
    const counting = (name: string): AiEngine => ({ ...base, name, detect: async (imgs) => (calls++, base.detect(imgs)) });
    const { d, repo, photos } = deps(counting("mock"));
    const id = await seedJob(repo, photos);
    await runDetect(id, d);
    await repo.updateJob(id, { stage: "queued" });
    await runDetect(id, { ...d, engine: counting("gemini:gemini-3.8-flash") });
    expect(calls).toBe(2);
  });

  it("fails unusable photos with a clear code", async () => {
    const engine = fakeEngine({ detect: async (imgs) => imgs.map((i) => ({ image_index: i.index, quality: "blurry", items: [] })) });
    const { d, repo, photos } = deps(engine);
    const id = await seedJob(repo, photos);
    await runDetect(id, d);
    expect(await repo.getJob(id)).toMatchObject({ status: "needs_review", error_code: "photos_unusable" });
  });

  it("ignores duplicate deliveries once past detection", async () => {
    const { d, repo, photos, queue } = deps();
    const id = await seedJob(repo, photos);
    await runDetect(id, d);
    await runDetect(id, d);
    expect(queue.length).toBe(1);
  });
});

describe("cross-photo de-duplication", () => {
  it("counts each part from the photo where it appears most", () => {
    const rows = [
      { part_id: "uno", image_index: 0, quantity: 1, duplicate: false },
      { part_id: "uno", image_index: 1, quantity: 1, duplicate: false },
      { part_id: "motor", image_index: 0, quantity: 1, duplicate: false },
      { part_id: "motor", image_index: 1, quantity: 1, duplicate: false },
      { part_id: "motor", image_index: 1, quantity: 1, duplicate: false },
      { part_id: null, image_index: 1, quantity: 1, duplicate: false },
    ];
    markCrossPhotoDuplicates(rows);
    expect(rows.map((r) => r.duplicate)).toEqual([false, true, true, false, false, false]);
  });
});

describe("plan stage", () => {
  async function readyForPlan(engine?: AiEngine) {
    const ctx = deps(engine);
    const id = await seedJob(ctx.repo, ctx.photos);
    await runDetect(id, ctx.d);
    return { ...ctx, id };
  }

  it("saves the result and marks the job ready", async () => {
    const { d, repo, id } = await readyForPlan();
    await runPlan(id, 0, d);
    expect(await repo.getJob(id)).toMatchObject({ status: "ready", stage: "done", intent: "specific" });
    expect((await repo.getJob(id))?.summary).toMatchObject({ title: "Blink", verdict: "yes", missing_count: 0 });
    expect(await repo.latestResult(id)).toMatchObject({ kind: "single", plan_version: 0 });
  });

  it("marks needs_review when no plan passed validation", async () => {
    const base = fakeEngine();
    const engine: AiEngine = {
      ...base,
      plan: async (input) => {
        const out = await base.plan(input);
        const p = out.payload.plans[0]!;
        p.validation = { passed: false, attempts: 4, issues: [] };
        return out;
      },
    };
    const { d, repo, id } = await readyForPlan(engine);
    await runPlan(id, 0, d);
    expect(await repo.getJob(id)).toMatchObject({ status: "needs_review", error_code: "plan_invalid_after_repairs" });
  });

  it("drops stale plan messages after the user changed parts", async () => {
    const { d, repo, id } = await readyForPlan();
    await repo.updateJob(id, { plan_version: 1 });
    await runPlan(id, 0, d);
    expect(await repo.latestResult(id)).toBeNull();
  });

  it("does not save a result if parts changed while planning", async () => {
    const base = fakeEngine();
    const ctx = deps();
    const id = await seedJob(ctx.repo, ctx.photos);
    await runDetect(id, ctx.d);
    ctx.d.engine = {
      ...base,
      plan: async (input) => {
        await ctx.repo.updateJob(id, { plan_version: 1 });
        return base.plan(input);
      },
    };
    await runPlan(id, 0, ctx.d);
    expect(await ctx.repo.latestResult(id)).toBeNull();
  });

  it("serves identical re-plans from the per-user cache", async () => {
    let calls = 0;
    const base = fakeEngine();
    const { d, repo, id } = await readyForPlan({ ...base, plan: async (i) => (calls++, base.plan(i)) });
    await runPlan(id, 0, d);
    await repo.updateJob(id, { plan_version: 1, stage: "planning" });
    await runPlan(id, 1, d);
    expect(calls).toBe(1);
    expect((await repo.latestResult(id) as JobResultPayload).plan_version).toBe(1);
  });
});

describe("queue consumer", () => {
  it("retries retryable failures with backoff, then fails the job", async () => {
    const engine = fakeEngine({ detect: () => Promise.reject({ code: "model_unavailable", retryable: true }) });
    const { d, repo, photos } = deps(engine);
    const id = await seedJob(repo, photos);
    const first = msg({ type: "detect", job_id: id }, 1);
    await handleJobMessages([first], d);
    expect(first.retried).toBe(5);
    expect(first.acked).toBe(false);
    await repo.updateJob(id, { stage: "queued" });
    const last = msg({ type: "detect", job_id: id }, 3);
    await handleJobMessages([last], d);
    expect(last.acked).toBe(true);
    expect(await repo.getJob(id)).toMatchObject({ status: "needs_review", error_code: "model_unavailable" });
  });

  it("does not retry permanent failures", async () => {
    const engine = fakeEngine({ detect: () => Promise.reject({ code: "model_output_invalid", retryable: false }) });
    const { d, repo, photos } = deps(engine);
    const id = await seedJob(repo, photos);
    const m = msg({ type: "detect", job_id: id });
    await handleJobMessages([m], d);
    expect(m.retried).toBeUndefined();
    expect(await repo.getJob(id)).toMatchObject({ error_code: "model_output_invalid" });
  });

  it("acks malformed messages and fails dead-lettered jobs", async () => {
    const { d, repo, photos } = deps();
    const bad = msg({ type: "explode" });
    await handleJobMessages([bad], d);
    expect(bad.acked).toBe(true);
    const id = await seedJob(repo, photos);
    await handleDeadLetters([msg({ type: "detect", job_id: id })], d);
    expect(await repo.getJob(id)).toMatchObject({ status: "needs_review" });
  });
});

describe("retention", () => {
  it("deletes photos older than 30 days", async () => {
    const { repo, photos } = deps();
    const id = await seedJob(repo, photos);
    repo.jobs.get(id)!.created_at = new Date(Date.now() - 31 * 864e5).toISOString();
    const res = await cleanupExpired(repo, photos);
    expect(res.jobs).toBe(1);
    expect(photos.objects.size).toBe(0);
    expect((await repo.getJob(id))?.photos_deleted_at).not.toBeNull();
  });
});
