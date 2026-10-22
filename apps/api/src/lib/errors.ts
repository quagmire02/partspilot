import { ERROR_HTTP_STATUS, type ErrorCode } from "@partspilot/shared";

/** Static developer-facing messages. Never include user input. */
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  unauthorized: "A valid access token is required.",
  forbidden: "Not allowed.",
  rate_limited: "Too many requests.",
  turnstile_failed: "Human verification failed.",
  ticket_invalid: "Upload ticket is invalid, expired or already used.",
  quota_exceeded: "Daily job limit reached.",
  bad_request: "The request is malformed.",
  not_found: "Not found.",
  conflict: "The resource changed; reload and retry.",
  payload_too_large: "A photo exceeds the 10 MB limit.",
  too_many_photos: "At most 4 photos are allowed.",
  no_photos: "At least one photo is required.",
  unsupported_media_type: "Photos must be JPEG, PNG or WebP.",
  heic_not_converted: "HEIC photos must be converted to JPEG on the device.",
  image_too_small: "A photo is too small to analyse.",
  image_corrupt: "A photo could not be read.",
  goal_too_long: "The goal text is too long.",
  unknown_part: "Unknown catalog part.",
  internal: "Internal error.",
};

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryAfterS?: number,
  ) {
    super(code);
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: MESSAGES[this.code] ?? this.code,
        ...(this.retryAfterS !== undefined ? { retry_after_s: this.retryAfterS } : {}),
      },
    };
  }
}

/** Pipeline failure that should not be retried by the queue. */
export class PermanentError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
