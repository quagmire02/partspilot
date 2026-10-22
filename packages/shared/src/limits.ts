/** Single source of truth for product limits. Server code enforces; clients only display. */
export const LIMITS = {
  DAILY_JOBS: 10,
  MAX_PHOTOS: 4,
  MAX_PHOTO_BYTES: 10 * 1024 * 1024,
  MIN_PHOTO_SHORT_EDGE_PX: 480,
  SIGNED_URL_TTL_S: 300,
  AUTO_ACCEPT_CONFIDENCE: 0.85,
  MAX_REPAIR_ATTEMPTS: 3,
  PHOTO_RETENTION_DAYS: 30,
  MAX_GOAL_CHARS: 500,
  TOP_K_MATCHES: 3,
  MAX_DETECTIONS_PER_IMAGE: 40,
  MAX_PARTS_PER_JOB: 60,
  MAX_UPLOAD_TICKETS: 3,
  UPLOAD_TICKET_TTL_S: 24 * 60 * 60,
  DISCOVERY_IDEAS: 3,
  /** Requests per minute per user / per IP (Workers rate-limit binding). */
  RATE_PER_USER_PER_MIN: 60,
  RATE_PER_IP_PER_MIN: 120,
  UPLOADS_PER_USER_PER_MIN: 6,
  /** Re-plans (part corrections) allowed per job; each one costs model calls. */
  MAX_REPLANS_PER_JOB: 20,
} as const;

/** Bumped whenever prompts/models change so the result cache invalidates. */
export const PIPELINE_VERSIONS = {
  detector: "det-1",
  planner: "plan-1",
} as const;

export const DEEP_LINK_SCHEME = "partspilot";
export const DESKTOP_AUTH_CALLBACK = `${DEEP_LINK_SCHEME}://auth/callback`;
