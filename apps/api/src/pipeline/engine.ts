import type {
  CodeLanguage,
  ErrorCode,
  ImageDetection,
  JobResultPayload,
  JobStage,
  MatchCandidate,
} from "@partspilot/shared";

/**
 * What the pipeline needs from the AI layer (packages/ai implements it). Inputs and
 * outputs are already Zod-validated by the engine; the pipeline only orchestrates
 * storage, database, cache and queue around it.
 */
export interface AiEngine {
  /** Provider + model id (e.g. "gemini:gemini-3.8-flash"); part of result-cache keys. */
  readonly name: string;
  detect(images: { index: number; bytes: Uint8Array; mime: string }[]): Promise<ImageDetection[]>;
  /** Top-3 calibrated candidates per item, same order as the input. */
  match(items: { label: string; visible_text: string[]; confidence?: number }[]): Promise<MatchCandidate[][]>;
  plan(input: {
    goal: string;
    parts: { part_id: string; quantity: number }[];
    planVersion: number;
    languageHint?: CodeLanguage | null;
    onStage?: (stage: Extract<JobStage, "planning" | "validating" | "rendering">) => Promise<void>;
  }): Promise<{ intent: "specific" | "discovery"; payload: JobResultPayload }>;
}

/** Errors thrown by the engine carry a stable code and whether a retry may help. */
export interface PipelineFailure {
  code: ErrorCode;
  retryable: boolean;
}

export function asPipelineFailure(err: unknown): PipelineFailure {
  if (err && typeof err === "object" && "code" in err && "retryable" in err) {
    const e = err as { code: unknown; retryable: unknown };
    if (typeof e.code === "string" && typeof e.retryable === "boolean") {
      return { code: e.code as ErrorCode, retryable: e.retryable };
    }
  }
  return { code: "internal", retryable: true };
}
