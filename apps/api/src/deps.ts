import { isLocalStack, type QueueMessage } from "@partspilot/shared";
import type { Env } from "./env.js";
import type { PhotoStore, Repo } from "./db/types.js";
import { createServiceClient, createSupabasePhotoStore, createSupabaseRepo } from "./db/supabase.js";
import { createTokenVerifier, type TokenVerifier } from "./lib/jwt.js";
import { createTurnstileVerifier, type TurnstileVerifier } from "./lib/turnstile.js";

export interface Limiter {
  /** true = allowed. */
  allow(key: string): Promise<boolean>;
}

export interface Deps {
  repo: Repo;
  photos: PhotoStore;
  enqueue: (msg: QueueMessage) => Promise<void>;
  verifyToken: TokenVerifier;
  verifyTurnstile: TurnstileVerifier;
  limiters: { ip: Limiter; user: Limiter; upload: Limiter };
  allowedOrigins: string[];
  now: () => Date;
}

const fromBinding = (rl: RateLimit): Limiter => ({
  allow: async (key) => (await rl.limit({ key })).success,
});

let cached: { key: string; deps: Deps } | null = null;

/** Builds production deps from the Worker env, cached per isolate. */
export function depsFromEnv(env: Env): Deps {
  const key = `${env.SUPABASE_URL}|${env.ALLOWED_ORIGINS}`;
  if (cached?.key === key) return cached.deps;
  const sb = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const deps: Deps = {
    repo: createSupabaseRepo(sb),
    photos: createSupabasePhotoStore(sb, env.PHOTO_BUCKET ?? "photos"),
    enqueue: async (msg) => {
      await env.JOBS_QUEUE.send(msg, { contentType: "json" });
    },
    verifyToken: createTokenVerifier({ supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET }),
    // Self-hosting: no Cloudflare widget on a single-user local install. Never honoured
    // against a hosted Supabase, so a stray "off" cannot disable it in production.
    verifyTurnstile:
      env.TURNSTILE_SECRET === "off" && isLocalStack(env.SUPABASE_URL) ? async () => true : createTurnstileVerifier(env.TURNSTILE_SECRET),
    limiters: { ip: fromBinding(env.RL_IP), user: fromBinding(env.RL_USER), upload: fromBinding(env.RL_UPLOAD) },
    allowedOrigins: env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    now: () => new Date(),
  };
  cached = { key, deps };
  return deps;
}
