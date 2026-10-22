import type {
  BBox,
  CatalogPart,
  CatalogSearchItem,
  ErrorCode,
  InventoryItem,
  JobPartStatus,
  JobResultPayload,
  JobStage,
  JobStatus,
  JobSummary,
  MatchCandidate,
  PlannerOutput,
} from "@partspilot/shared";
import type { ImageMime } from "../lib/images.js";

export interface PhotoMeta {
  index: number;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  mime: ImageMime;
}

export interface JobRow {
  id: string;
  user_id: string;
  client_request_id: string;
  source: "photo" | "inventory";
  goal: string | null;
  intent: "specific" | "discovery" | null;
  status: JobStatus;
  stage: JobStage;
  plan_version: number;
  error_code: ErrorCode | null;
  photo_count: number;
  photo_paths: string[];
  photo_meta: PhotoMeta[];
  image_set_hash: string | null;
  photos_deleted_at: string | null;
  summary: JobSummary | null;
  created_at: string;
  updated_at: string;
}

export type JobPatch = Partial<
  Pick<
    JobRow,
    | "intent"
    | "status"
    | "stage"
    | "plan_version"
    | "error_code"
    | "photo_paths"
    | "photo_meta"
    | "image_set_hash"
    | "summary"
  >
>;

export interface JobPartRow {
  id: string;
  job_id: string;
  user_id: string;
  image_index: number | null;
  bbox: BBox | null;
  label: string;
  visible_text: string[];
  detection_confidence: number;
  candidates: MatchCandidate[];
  part_id: string | null;
  confidence: number;
  quantity: number;
  status: JobPartStatus;
  duplicate: boolean;
}

export type NewJobPart = Omit<JobPartRow, "id">;
export type JobPartPatch = Partial<Pick<JobPartRow, "part_id" | "quantity" | "status" | "confidence">>;

export interface CreateJobResult {
  jobId: string | null;
  duplicate: boolean;
  allowed: boolean;
  used: number;
}

export interface CatalogMatchRow {
  part_id: string;
  name: string;
  has_profile: boolean;
  alias: string;
  vec_sim: number;
  trgm_sim: number;
}

export interface ReferenceProjectRow {
  id: string;
  title: string;
  plan: PlannerOutput;
  similarity: number;
}

export interface Repo {
  createJob(a: {
    userId: string;
    clientRequestId: string;
    source: "photo" | "inventory";
    goal: string;
    photoCount: number;
    limit: number;
  }): Promise<CreateJobResult>;
  refundJob(jobId: string): Promise<void>;
  quotaUsed(userId: string): Promise<number>;
  /** Job id already created for this idempotency key, if any. */
  findJobByRequest(userId: string, clientRequestId: string): Promise<string | null>;
  /** When userId is given the job must belong to that user. */
  getJob(jobId: string, userId?: string): Promise<JobRow | null>;
  listJobs(userId: string, q: { limit: number; updatedAfter?: string; before?: string }): Promise<JobRow[]>;
  /** Optimistic update; returns null when expectPlanVersion no longer matches. */
  updateJob(jobId: string, patch: JobPatch, opts?: { expectPlanVersion?: number }): Promise<JobRow | null>;
  deleteJob(jobId: string, userId: string): Promise<boolean>;

  listJobParts(jobId: string): Promise<JobPartRow[]>;
  replaceDetectedParts(jobId: string, rows: NewJobPart[]): Promise<void>;
  insertJobParts(rows: NewJobPart[]): Promise<void>;
  updateJobPart(id: string, patch: JobPartPatch): Promise<void>;
  applyInventory(jobId: string): Promise<void>;

  saveResult(jobId: string, userId: string, planVersion: number, payload: JobResultPayload): Promise<void>;
  latestResult(jobId: string): Promise<JobResultPayload | null>;

  issueTickets(userId: string, max: number, ttlS: number): Promise<{ id: string; expires_at: string }[]>;
  consumeTicket(userId: string, ticketId: string): Promise<boolean>;
  releaseTicket(userId: string, ticketId: string): Promise<void>;

  searchCatalog(q: string, limit: number): Promise<CatalogSearchItem[]>;
  getCatalogParts(ids: string[]): Promise<CatalogPart[]>;
  listProfiledParts(): Promise<CatalogPart[]>;
  matchCatalog(embedding: number[] | null, query: string, k: number): Promise<CatalogMatchRow[]>;
  matchReferenceProjects(embedding: number[], k: number): Promise<ReferenceProjectRow[]>;
  listReferenceProjects(): Promise<(ReferenceProjectRow & { goal_examples: string[] })[]>;

  listInventory(userId: string): Promise<InventoryItem[]>;
  setInventory(userId: string, partId: string, quantity: number): Promise<void>;

  getCache<T>(userId: string, key: string): Promise<T | null>;
  setCache(userId: string, key: string, kind: "detect" | "plan", payload: unknown): Promise<void>;

  expiredPhotos(days: number, limit: number): Promise<{ id: string; photo_paths: string[] }[]>;
  markPhotosDeleted(ids: string[]): Promise<number>;
  purgeCache(days: number): Promise<number>;
}

export interface PhotoStore {
  put(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  signedUrls(paths: string[], ttlS: number): Promise<(string | null)[]>;
  remove(paths: string[]): Promise<void>;
}
