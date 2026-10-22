import { z } from "zod";
import { CatalogSearchItem, PartCategory, PartId } from "./catalog";
import { Job, JobPart } from "./job";
import { JobResultPayload } from "./plan";
import { LIMITS } from "./limits";

const Timestamp = z.iso.datetime({ offset: true });

export const Quota = z.object({
  limit: z.number().int(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resets_at: Timestamp,
});
export type Quota = z.infer<typeof Quota>;

export const MeResponse = z.object({
  user_id: z.uuid(),
  email: z.string().nullable(),
  quota: Quota,
});
export type MeResponse = z.infer<typeof MeResponse>;

// --- phone ---------------------------------------------------------------

export const UploadTicketsRequest = z.object({
  turnstile_token: z.string().min(1).max(4096),
});
export type UploadTicketsRequest = z.infer<typeof UploadTicketsRequest>;

export const UploadTicket = z.object({ id: z.uuid(), expires_at: Timestamp });
export type UploadTicket = z.infer<typeof UploadTicket>;

export const UploadTicketsResponse = z.object({ tickets: z.array(UploadTicket) });
export type UploadTicketsResponse = z.infer<typeof UploadTicketsResponse>;

export const GoalText = z
  .string()
  .max(LIMITS.MAX_GOAL_CHARS)
  .transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim());

/**
 * Non-file fields of the multipart `POST /v1/jobs` body. Files go in repeated
 * `photos` fields (1..MAX_PHOTOS). Exactly one of turnstile_token / upload_ticket.
 */
export const CreateJobFields = z
  .object({
    client_request_id: z.uuid(),
    goal: GoalText.default(""),
    turnstile_token: z.string().min(1).max(4096).optional(),
    upload_ticket: z.uuid().optional(),
  })
  .refine((f) => Boolean(f.turnstile_token) !== Boolean(f.upload_ticket), {
    message: "send exactly one of turnstile_token or upload_ticket",
  });
export type CreateJobFields = z.infer<typeof CreateJobFields>;

export const CreateJobResponse = z.object({
  job_id: z.uuid(),
  status: z.literal("processing"),
  /** True when this client_request_id was already accepted (idempotent replay). */
  duplicate: z.boolean(),
  quota: Quota,
});
export type CreateJobResponse = z.infer<typeof CreateJobResponse>;

// --- desktop -------------------------------------------------------------

export const JobListItem = Job.extend({
  thumbnail_url: z.url().nullable(),
});
export type JobListItem = z.infer<typeof JobListItem>;

export const JobListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** ISO timestamp; returns jobs updated strictly after it (catch-up after PC was off). */
  updated_after: Timestamp.optional(),
  before: Timestamp.optional(),
});
export type JobListQuery = z.infer<typeof JobListQuery>;

export const JobListResponse = z.object({ items: z.array(JobListItem) });
export type JobListResponse = z.infer<typeof JobListResponse>;

export const JobPhoto = z.object({
  index: z.number().int().min(0).max(3),
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  expires_at: Timestamp,
});
export type JobPhoto = z.infer<typeof JobPhoto>;

export const JobDetailResponse = z.object({
  job: Job,
  photos: z.array(JobPhoto),
  parts: z.array(JobPart),
  result: JobResultPayload.nullable(),
});
export type JobDetailResponse = z.infer<typeof JobDetailResponse>;

export const UpdatePartsRequest = z.object({
  /** Optimistic concurrency: the plan_version the client was looking at. */
  plan_version: z.number().int().nonnegative(),
  parts: z
    .array(
      z.object({
        /** Existing job_part id; omit for a user-added part. */
        id: z.uuid().optional(),
        part_id: PartId,
        quantity: z.number().int().min(1).max(50),
        removed: z.boolean().default(false),
      }),
    )
    .max(LIMITS.MAX_PARTS_PER_JOB),
});
export type UpdatePartsRequest = z.infer<typeof UpdatePartsRequest>;
export type UpdatePartsRequestInput = z.input<typeof UpdatePartsRequest>;

export const UpdatePartsResponse = z.object({ job: Job });
export type UpdatePartsResponse = z.infer<typeof UpdatePartsResponse>;

export const DeleteJobResponse = z.object({ deleted: z.literal(true) });
export type DeleteJobResponse = z.infer<typeof DeleteJobResponse>;

export const CatalogSearchQuery = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuery>;

export const CatalogSearchResponse = z.object({ items: z.array(CatalogSearchItem) });
export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponse>;

export const InventoryItem = z.object({
  part_id: PartId,
  name: z.string(),
  category: PartCategory,
  quantity: z.number().int().min(0),
  updated_at: Timestamp,
});
export type InventoryItem = z.infer<typeof InventoryItem>;

export const InventoryResponse = z.object({ items: z.array(InventoryItem) });
export type InventoryResponse = z.infer<typeof InventoryResponse>;

export const PutInventoryRequest = z.object({
  /** 0 removes the item. */
  quantity: z.number().int().min(0).max(999),
});
export type PutInventoryRequest = z.infer<typeof PutInventoryRequest>;

export const InventoryPlanRequest = z.object({
  client_request_id: z.uuid(),
  goal: GoalText.default(""),
});
export type InventoryPlanRequest = z.infer<typeof InventoryPlanRequest>;

export const InventoryPlanResponse = z.object({ job_id: z.uuid(), quota: Quota });
export type InventoryPlanResponse = z.infer<typeof InventoryPlanResponse>;
