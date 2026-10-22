import { z } from "zod";

/**
 * Stable machine-readable error codes. Logs and API errors carry only these codes,
 * never free text derived from user content.
 */
export const ErrorCode = z.enum([
  // auth / abuse
  "unauthorized",
  "forbidden",
  "rate_limited",
  "turnstile_failed",
  "ticket_invalid",
  "quota_exceeded",
  // input
  "bad_request",
  "not_found",
  "conflict",
  "payload_too_large",
  "too_many_photos",
  "no_photos",
  "unsupported_media_type",
  "heic_not_converted",
  "image_too_small",
  "image_corrupt",
  "goal_too_long",
  "unknown_part",
  // pipeline
  "photos_unusable",
  "no_parts_detected",
  "model_output_invalid",
  "model_unavailable",
  "plan_invalid_after_repairs",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    /** Static, developer-facing message keyed by code. Never echoes user input. */
    message: z.string(),
    retry_after_s: z.number().int().nonnegative().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  turnstile_failed: 403,
  ticket_invalid: 403,
  quota_exceeded: 429,
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  too_many_photos: 400,
  no_photos: 400,
  unsupported_media_type: 415,
  heic_not_converted: 415,
  image_too_small: 422,
  image_corrupt: 422,
  goal_too_long: 400,
  unknown_part: 422,
  photos_unusable: 422,
  no_parts_detected: 422,
  model_output_invalid: 502,
  model_unavailable: 503,
  plan_invalid_after_repairs: 422,
  internal: 500,
};

/** Plain-language text the apps show for job-level error codes. */
export const ERROR_USER_TEXT: Partial<Record<ErrorCode, string>> = {
  photos_unusable: "The photos were too blurry or dark to read. Retake them in good light.",
  no_parts_detected: "No electronic parts were found in the photos.",
  model_output_invalid: "The analysis returned an unreadable answer. Try again.",
  model_unavailable: "The analysis service is busy. The job will retry automatically.",
  plan_invalid_after_repairs:
    "We could not produce wiring that passes the safety checks. See the issues below.",
  quota_exceeded: "Daily limit reached. Scans reset at midnight UTC.",
  internal: "Something went wrong on our side.",
};
