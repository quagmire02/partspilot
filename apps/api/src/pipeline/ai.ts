import { configFingerprint, createEngine, providerFromConfig, type CatalogAccess, type ModelProvider } from "@partspilot/ai";
import type { Env } from "../env.js";
import type { Repo } from "../db/types.js";
import type { AiEngine } from "./engine.js";

/** Adapts the Worker repo to what the AI layer reads. */
export function catalogAccess(repo: Repo): CatalogAccess {
  return {
    matchCatalog: (e, q, k) => repo.matchCatalog(e, q, k),
    getParts: (ids) => repo.getCatalogParts(ids),
    listProfiledParts: () => repo.listProfiledParts(),
    matchReferenceProjects: (e, k) => repo.matchReferenceProjects(e, k),
    listReferenceProjects: () => repo.listReferenceProjects(),
  };
}

/**
 * Gemini by default; `AI_PROVIDER=openai` for any OpenAI-compatible API (Ollama, LM Studio,
 * OpenAI, Groq…). A provider without its settings fails stages with a clear code instead of
 * calling out. The mock provider is only reachable through `AI_PROVIDER=mock`.
 */
export function providerFromEnv(env: Env): ModelProvider {
  return providerFromConfig(env);
}

let cached: { key: string; engine: AiEngine } | null = null;

export function engineFromEnv(env: Env, repo: Repo): AiEngine {
  const key = configFingerprint(env);
  if (cached?.key === key) return cached.engine;
  const engine = createEngine({ provider: providerFromEnv(env), catalog: catalogAccess(repo) });
  cached = { key, engine };
  return engine;
}
