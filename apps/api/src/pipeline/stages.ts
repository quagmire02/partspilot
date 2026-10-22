import {
  LIMITS,
  PIPELINE_VERSIONS,
  type ErrorCode,
  type ImageDetection,
  type JobResultPayload,
  type JobSummary,
  type QueueMessage,
} from "@partspilot/shared";
import type { JobPartRow, NewJobPart, PhotoStore, Repo } from "../db/types.js";
import { sha256Hex } from "../lib/images.js";
import { log, timer } from "../lib/log.js";
import type { AiEngine } from "./engine.js";

export interface PipelineDeps {
  repo: Repo;
  photos: PhotoStore;
  engine: AiEngine;
  enqueue: (msg: QueueMessage) => Promise<void>;
}

/** Detections below this are treated as noise and dropped before matching. */
const MIN_DETECTION_CONFIDENCE = 0.3;

export async function failJob(repo: Repo, jobId: string, code: ErrorCode): Promise<void> {
  await repo.updateJob(jobId, { stage: "failed", status: "needs_review", error_code: code });
  log("job_failed", { job_id: jobId, code });
}

// ---------------------------------------------------------------------------
// detect → match → (auto-accept → plan | needs_check)
// ---------------------------------------------------------------------------

export async function runDetect(jobId: string, d: PipelineDeps): Promise<void> {
  const elapsed = timer();
  const job = await d.repo.getJob(jobId);
  if (!job || !["queued", "detecting", "matching"].includes(job.stage)) return; // deleted or duplicate delivery
  await d.repo.updateJob(jobId, { stage: "detecting", status: "processing" });

  const cacheKey = `detect:${PIPELINE_VERSIONS.detector}:${d.engine.name}:${job.image_set_hash}`;
  let detections = job.image_set_hash ? await d.repo.getCache<ImageDetection[]>(job.user_id, cacheKey) : null;
  if (!detections) {
    const images = await Promise.all(
      job.photo_paths.map(async (path, index) => ({
        index,
        bytes: await d.photos.get(path),
        mime: job.photo_meta[index]?.mime ?? "image/jpeg",
      })),
    );
    detections = await d.engine.detect(images);
    if (job.image_set_hash) await d.repo.setCache(job.user_id, cacheKey, "detect", detections);
  }

  const items = detections.flatMap((det) =>
    det.items
      .filter((it) => it.confidence >= MIN_DETECTION_CONFIDENCE)
      .map((it) => ({ ...it, image_index: det.image_index })),
  );
  if (items.length === 0) {
    const allBad = detections.every((det) => det.quality !== "ok");
    return failJob(d.repo, jobId, allBad ? "photos_unusable" : "no_parts_detected");
  }

  await d.repo.updateJob(jobId, { stage: "matching" });
  const candidates = await d.engine.match(
    items.map((it) => ({ label: it.label, visible_text: it.visible_text, confidence: it.confidence })),
  );

  const rows: NewJobPart[] = items.slice(0, LIMITS.MAX_PARTS_PER_JOB).map((it, k) => {
    const top = (candidates[k] ?? []).slice(0, LIMITS.TOP_K_MATCHES);
    const best = top[0];
    const auto = Boolean(best && best.score >= LIMITS.AUTO_ACCEPT_CONFIDENCE);
    return {
      job_id: jobId,
      user_id: job.user_id,
      image_index: it.image_index,
      bbox: it.bbox,
      label: it.label,
      visible_text: it.visible_text,
      detection_confidence: it.confidence,
      candidates: top,
      part_id: best?.part_id ?? null,
      confidence: best?.score ?? 0,
      quantity: it.quantity,
      status: auto ? "auto" : "needs_check",
      duplicate: false,
    };
  });
  markCrossPhotoDuplicates(rows);
  await d.repo.replaceDetectedParts(jobId, rows);

  const needsCheck = rows.filter((r) => r.status === "needs_check" && !r.duplicate).length;
  const summary: JobSummary = {
    title: null,
    verdict: null,
    missing_count: null,
    needs_check_count: needsCheck,
    idea_titles: [],
  };
  if (needsCheck > 0) {
    await d.repo.updateJob(jobId, { stage: "awaiting_confirmation", status: "needs_check", summary });
    log("job_needs_check", { job_id: jobId, n: needsCheck, ms: elapsed() });
    return;
  }
  await d.repo.applyInventory(jobId);
  await d.repo.updateJob(jobId, { stage: "planning", summary });
  await d.enqueue({ type: "plan", job_id: jobId, plan_version: job.plan_version });
  log("job_detected", { job_id: jobId, n: rows.length, ms: elapsed() });
}

/**
 * Photos of one pile overlap. Per part id, the photo with the highest total count is
 * authoritative; the same part in the other photos is drawn but not counted.
 */
export function markCrossPhotoDuplicates(rows: Pick<NewJobPart, "part_id" | "image_index" | "quantity" | "duplicate">[]): void {
  const perPart = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (!r.part_id || r.image_index === null) continue;
    const byImage = perPart.get(r.part_id) ?? new Map<number, number>();
    byImage.set(r.image_index, (byImage.get(r.image_index) ?? 0) + r.quantity);
    perPart.set(r.part_id, byImage);
  }
  const keep = new Map<string, number>();
  for (const [partId, byImage] of perPart) {
    const [bestImage] = [...byImage.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
    keep.set(partId, bestImage);
  }
  for (const r of rows) {
    if (r.part_id && r.image_index !== null) r.duplicate = keep.get(r.part_id) !== r.image_index;
  }
}

// ---------------------------------------------------------------------------
// plan → validate → repair → render → save
// ---------------------------------------------------------------------------

export function activeParts(rows: JobPartRow[]): { part_id: string; quantity: number }[] {
  const qty = new Map<string, number>();
  for (const r of rows) {
    if (!r.part_id || r.duplicate || !["auto", "confirmed", "added"].includes(r.status)) continue;
    qty.set(r.part_id, (qty.get(r.part_id) ?? 0) + r.quantity);
  }
  return [...qty.entries()].map(([part_id, quantity]) => ({ part_id, quantity })).sort((a, b) => a.part_id.localeCompare(b.part_id));
}

export function summarize(payload: JobResultPayload): JobSummary {
  const first = payload.plans[0];
  return {
    title: payload.kind === "discovery" ? null : (first?.title ?? null),
    verdict: payload.kind === "discovery" ? null : (first?.verdict ?? (payload.kind === "refusal" ? "refused" : null)),
    missing_count: payload.kind === "discovery" ? null : (first?.missing.reduce((n, m) => n + m.qty, 0) ?? null),
    needs_check_count: 0,
    idea_titles: payload.kind === "discovery" ? payload.plans.map((p) => p.title) : [],
  };
}

export async function runPlan(jobId: string, planVersion: number, d: PipelineDeps): Promise<void> {
  const elapsed = timer();
  const job = await d.repo.getJob(jobId);
  if (!job || job.plan_version !== planVersion || job.stage === "done") return; // stale or duplicate

  const parts = activeParts(await d.repo.listJobParts(jobId));
  if (parts.length === 0) return failJob(d.repo, jobId, "no_parts_detected");
  await d.repo.updateJob(jobId, { stage: "planning", status: "processing" }, { expectPlanVersion: planVersion });

  const goal = job.goal ?? "";
  const cacheKey = `plan:${PIPELINE_VERSIONS.planner}:${d.engine.name}:${await sha256Hex(JSON.stringify({ goal, parts }))}`;
  let cached = await d.repo.getCache<{ intent: "specific" | "discovery"; payload: JobResultPayload }>(job.user_id, cacheKey);
  if (cached) cached = { ...cached, payload: { ...cached.payload, plan_version: planVersion } };
  const out =
    cached ??
    (await d.engine.plan({
      goal,
      parts,
      planVersion,
      onStage: async (stage) => {
        await d.repo.updateJob(jobId, { stage }, { expectPlanVersion: planVersion });
      },
    }));

  const passed = out.payload.kind === "refusal" || out.payload.plans.some((p) => p.validation.passed);
  if (!cached && passed) await d.repo.setCache(job.user_id, cacheKey, "plan", out);

  const current = await d.repo.getJob(jobId);
  if (!current || current.plan_version !== planVersion) return; // user changed parts meanwhile
  await d.repo.saveResult(jobId, job.user_id, planVersion, out.payload);
  await d.repo.updateJob(
    jobId,
    {
      stage: "done",
      status: passed ? "ready" : "needs_review",
      error_code: passed ? null : "plan_invalid_after_repairs",
      intent: out.intent,
      summary: summarize(out.payload),
    },
    { expectPlanVersion: planVersion },
  );
  log("job_planned", { job_id: jobId, plan_version: planVersion, status: passed ? "ready" : "needs_review", ms: elapsed() });
}
