import { z } from "zod";
import { ErrorCode } from "./errors";
import { BBox, MatchCandidate } from "./detection";
import { Verdict } from "./plan";

export const JobStatus = z.enum(["processing", "needs_check", "ready", "needs_review"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobStage = z.enum([
  "queued",
  "detecting",
  "matching",
  "awaiting_confirmation",
  "planning",
  "validating",
  "rendering",
  "done",
  "failed",
]);
export type JobStage = z.infer<typeof JobStage>;

export const JobSource = z.enum(["photo", "inventory"]);
export type JobSource = z.infer<typeof JobSource>;

const Timestamp = z.iso.datetime({ offset: true });

export const JobSummary = z.object({
  title: z.string().nullable().default(null),
  verdict: Verdict.nullable().default(null),
  missing_count: z.number().int().nonnegative().nullable().default(null),
  needs_check_count: z.number().int().nonnegative().nullable().default(null),
  idea_titles: z.array(z.string()).default([]),
});
export type JobSummary = z.infer<typeof JobSummary>;

export const Job = z.object({
  id: z.uuid(),
  created_at: Timestamp,
  updated_at: Timestamp,
  source: JobSource,
  /** Raw user goal. Untrusted data; render as text only. */
  goal: z.string().nullable(),
  intent: z.enum(["specific", "discovery"]).nullable(),
  status: JobStatus,
  stage: JobStage,
  plan_version: z.number().int().nonnegative(),
  error_code: ErrorCode.nullable(),
  photo_count: z.number().int().min(0).max(4),
  summary: JobSummary.nullable(),
});
export type Job = z.infer<typeof Job>;

export const JobPartStatus = z.enum(["auto", "needs_check", "confirmed", "added", "removed"]);
export type JobPartStatus = z.infer<typeof JobPartStatus>;

export const JobPart = z.object({
  id: z.uuid(),
  image_index: z.number().int().min(0).max(3).nullable(),
  bbox: BBox.nullable(),
  /** Detector label and printed text: untrusted data. */
  label: z.string(),
  visible_text: z.array(z.string()),
  candidates: z.array(MatchCandidate).max(3),
  part_id: z.string().nullable(),
  name: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  quantity: z.number().int().min(1).max(50),
  status: JobPartStatus,
  /**
   * Same part seen again in another photo of the same pile. Shown as a box on the photo,
   * excluded from the parts list, inventory and planning. Per part, the photo with the
   * highest count is authoritative (users photograph one pile from several angles).
   */
  duplicate: z.boolean().default(false),
});
export type JobPart = z.infer<typeof JobPart>;

export const QueueMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("detect"), job_id: z.uuid() }),
  z.object({ type: z.literal("plan"), job_id: z.uuid(), plan_version: z.number().int().nonnegative() }),
]);
export type QueueMessage = z.infer<typeof QueueMessage>;

/**
 * Default user-visible status for an internal stage. A job that reaches `done` without
 * a passing plan is stored as `needs_review` with `error_code` set — see architecture.md.
 */
export function statusForStage(stage: JobStage): JobStatus {
  switch (stage) {
    case "awaiting_confirmation":
      return "needs_check";
    case "done":
      return "ready";
    case "failed":
      return "needs_review";
    default:
      return "processing";
  }
}
