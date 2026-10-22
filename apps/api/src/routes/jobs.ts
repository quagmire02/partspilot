import { Hono } from "hono";
import { z } from "zod";
import { JobListQuery, LIMITS, UpdatePartsRequest } from "@partspilot/shared";
import type { AppEnv } from "../app.js";
import type { NewJobPart } from "../db/types.js";
import { HttpError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { toApiJob, toApiPart } from "./mappers.js";

export const jobRoutes = new Hono<AppEnv>();

const JobId = z.uuid();

function jobIdParam(raw: string | undefined): string {
  const id = JobId.safeParse(raw);
  if (!id.success) throw new HttpError("not_found");
  return id.data;
}

jobRoutes.get("/jobs", async (c) => {
  const { repo, photos } = c.get("deps");
  const user = c.get("user");
  const q = JobListQuery.parse(c.req.query());
  const rows = await repo.listJobs(user.id, { limit: q.limit, updatedAfter: q.updated_after, before: q.before });
  const thumbPaths = rows.map((r) => (r.photos_deleted_at ? undefined : r.photo_paths[0]));
  const wanted = thumbPaths.filter((p): p is string => Boolean(p));
  const signed = wanted.length ? await photos.signedUrls(wanted, LIMITS.SIGNED_URL_TTL_S) : [];
  const byPath = new Map(wanted.map((p, i) => [p, signed[i] ?? null]));
  return c.json({
    items: rows.map((r, i) => ({ ...toApiJob(r), thumbnail_url: thumbPaths[i] ? (byPath.get(thumbPaths[i]!) ?? null) : null })),
  });
});

jobRoutes.get("/jobs/:id", async (c) => {
  const { repo, photos, now } = c.get("deps");
  const user = c.get("user");
  const job = await repo.getJob(jobIdParam(c.req.param("id")), user.id);
  if (!job) throw new HttpError("not_found");

  const [parts, result, urls] = await Promise.all([
    repo.listJobParts(job.id),
    repo.latestResult(job.id),
    job.photos_deleted_at || !job.photo_paths.length
      ? Promise.resolve([] as (string | null)[])
      : photos.signedUrls(job.photo_paths, LIMITS.SIGNED_URL_TTL_S),
  ]);
  const catalog = new Map(
    (await repo.getCatalogParts(parts.flatMap((p) => (p.part_id ? [p.part_id] : [])))).map((p) => [p.id, p]),
  );
  const expires = new Date(now().getTime() + LIMITS.SIGNED_URL_TTL_S * 1000).toISOString();
  return c.json({
    job: toApiJob(job),
    photos: job.photo_meta.flatMap((m) => {
      const url = urls[m.index];
      return url ? [{ index: m.index, url, width: m.width, height: m.height, expires_at: expires }] : [];
    }),
    parts: parts.map((p) => toApiPart(p, catalog)),
    result,
  });
});

/** Confirm / correct / add / remove parts, then re-plan. The body is the full desired list. */
jobRoutes.put("/jobs/:id/parts", async (c) => {
  const { repo, enqueue } = c.get("deps");
  const user = c.get("user");
  const job = await repo.getJob(jobIdParam(c.req.param("id")), user.id);
  if (!job) throw new HttpError("not_found");
  const body = UpdatePartsRequest.parse(await c.req.json().catch(() => null));

  if (body.plan_version !== job.plan_version) throw new HttpError("conflict");
  if (job.stage === "queued" || job.stage === "detecting" || job.stage === "matching") throw new HttpError("conflict");
  if (job.plan_version >= LIMITS.MAX_REPLANS_PER_JOB) throw new HttpError("quota_exceeded");

  const known = new Map(
    (await repo.getCatalogParts(body.parts.map((p) => p.part_id))).map((p) => [p.id, p]),
  );
  if (body.parts.some((p) => !known.has(p.part_id))) throw new HttpError("unknown_part");

  const existing = new Map((await repo.listJobParts(job.id)).map((p) => [p.id, p]));
  if (body.parts.some((p) => p.id && !existing.has(p.id))) throw new HttpError("bad_request");

  const mentioned = new Set<string>();
  const added: NewJobPart[] = [];
  for (const p of body.parts) {
    if (p.id) {
      mentioned.add(p.id);
      const prev = existing.get(p.id)!;
      const status = p.removed ? "removed" : prev.status === "added" ? "added" : "confirmed";
      const confidence = p.part_id === prev.part_id ? prev.confidence : 1;
      await repo.updateJobPart(p.id, { part_id: p.part_id, quantity: p.quantity, status, confidence });
    } else if (!p.removed) {
      added.push({
        job_id: job.id,
        user_id: user.id,
        image_index: null,
        bbox: null,
        label: known.get(p.part_id)!.name,
        visible_text: [],
        detection_confidence: 1,
        candidates: [],
        part_id: p.part_id,
        confidence: 1,
        quantity: p.quantity,
        status: "added",
        duplicate: false,
      });
    }
  }
  // Unmentioned rows were removed by the user — except cross-photo duplicates, which the
  // client never lists (they stay as drawn-but-uncounted boxes).
  for (const [id, prev] of existing) {
    if (!mentioned.has(id) && prev.status !== "removed" && !prev.duplicate) await repo.updateJobPart(id, { status: "removed" });
  }
  await repo.insertJobParts(added);
  if (job.source === "photo") await repo.applyInventory(job.id);

  const updated = await repo.updateJob(
    job.id,
    { plan_version: job.plan_version + 1, status: "processing", stage: "planning", error_code: null },
    { expectPlanVersion: job.plan_version },
  );
  if (!updated) throw new HttpError("conflict");
  await enqueue({ type: "plan", job_id: job.id, plan_version: updated.plan_version });
  log("job_replan", { job_id: job.id, user_id: user.id, plan_version: updated.plan_version });
  return c.json({ job: toApiJob(updated) }, 202);
});

jobRoutes.delete("/jobs/:id", async (c) => {
  const { repo, photos } = c.get("deps");
  const user = c.get("user");
  const job = await repo.getJob(jobIdParam(c.req.param("id")), user.id);
  if (!job) throw new HttpError("not_found");
  if (job.photo_paths.length) await photos.remove(job.photo_paths);
  await repo.deleteJob(job.id, user.id);
  log("job_deleted", { job_id: job.id, user_id: user.id });
  return c.json({ deleted: true as const });
});
