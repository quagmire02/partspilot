import type { QueueMessage } from "@partspilot/shared";

export interface Env {
  JOBS_QUEUE: Queue<QueueMessage>;
  RL_IP: RateLimit;
  RL_USER: RateLimit;
  RL_UPLOAD: RateLimit;

  SUPABASE_URL: string;
  /** Secret. Server-side only. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Secret. Only for the local Supabase stack (HS256); hosted projects use JWKS. */
  SUPABASE_JWT_SECRET?: string;
  /** Secret. "off" disables Turnstile, honoured only against a local Supabase (self-hosting). */
  TURNSTILE_SECRET: string;
  /** Secrets: GEMINI_API_KEY, OPENAI_API_KEY, EMBED_API_KEY. */
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  EMBED_API_KEY?: string;

  /** "gemini" (default) | "openai" (any OpenAI-compatible API, incl. Ollama) | "mock". */
  AI_PROVIDER?: string;
  AI_TIMEOUT_MS?: string;
  GEMINI_MODEL?: string;
  GEMINI_EMBED_MODEL?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  EMBED_BASE_URL?: string;
  /** Comma-separated exact origins (PWA + desktop webview). */
  ALLOWED_ORIGINS: string;
  PHOTO_BUCKET?: string;
}
