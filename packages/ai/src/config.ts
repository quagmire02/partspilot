import { createGeminiProvider } from "./gemini";
import { createMockProvider } from "./mock";
import { createOpenAiCompatProvider } from "./openai";
import { ModelError, type ModelProvider } from "./provider";

/** Flat settings as they appear in env / .dev.vars. Keys are secrets; the rest are not. */
export interface AiConfig {
  AI_PROVIDER?: string;
  AI_TIMEOUT_MS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_EMBED_MODEL?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  EMBED_BASE_URL?: string;
  EMBED_API_KEY?: string;
}

function unconfigured(detail: string): ModelProvider {
  const fail = () => Promise.reject(new ModelError("model_unavailable", false, detail));
  return { name: "unconfigured", generateJson: fail, embed: fail };
}

/**
 * AI_PROVIDER: "gemini" (default) | "openai" (any OpenAI-compatible API, incl. Ollama and
 * LM Studio) | "mock" (canned output for tests; ignores photos).
 */
export function providerFromConfig(c: AiConfig): ModelProvider {
  const timeoutMs = Number(c.AI_TIMEOUT_MS) || undefined;
  if (c.AI_PROVIDER === "mock") return createMockProvider();
  if (c.AI_PROVIDER === "openai") {
    if (!c.OPENAI_BASE_URL || !c.OPENAI_MODEL || !c.OPENAI_EMBED_MODEL) return unconfigured("missing_openai_config");
    return createOpenAiCompatProvider({
      baseUrl: c.OPENAI_BASE_URL,
      apiKey: c.OPENAI_API_KEY || undefined,
      model: c.OPENAI_MODEL,
      embedModel: c.OPENAI_EMBED_MODEL,
      embedBaseUrl: c.EMBED_BASE_URL || undefined,
      embedApiKey: c.EMBED_API_KEY || undefined,
      timeoutMs,
    });
  }
  if (!c.GEMINI_API_KEY) return unconfigured("missing_api_key");
  return createGeminiProvider({ apiKey: c.GEMINI_API_KEY, model: c.GEMINI_MODEL || undefined, embedModel: c.GEMINI_EMBED_MODEL || undefined, timeoutMs });
}

/** Identifies a configuration without exposing keys (engine reuse, cache keys). */
export function configFingerprint(c: AiConfig): string {
  return [c.AI_PROVIDER, c.GEMINI_MODEL, c.GEMINI_EMBED_MODEL, c.OPENAI_BASE_URL, c.OPENAI_MODEL, c.OPENAI_EMBED_MODEL, c.EMBED_BASE_URL, Boolean(c.GEMINI_API_KEY), Boolean(c.OPENAI_API_KEY)].join("|");
}
