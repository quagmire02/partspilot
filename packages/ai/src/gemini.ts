import { EMBEDDING_DIMS, ModelError, type ContentPart, type JsonRequest, type ModelProvider } from "./provider";

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  embedModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Keywords the constrained decoder may reject; Zod enforces them after decoding anyway. */
const STRIP = new Set(["$schema", "pattern", "format", "minLength", "maxLength", "$id", "id", "default"]);
export function simplifySchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(simplifySchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!STRIP.has(k)) out[k] = simplifySchema(v);
  return out;
}

/** Google Gemini over REST (fetch only — works in Workers, Node and browsers). */
export function createGeminiProvider(opts: GeminiOptions): ModelProvider {
  const model = opts.model ?? "gemini-3.8-flash";
  const embedModel = opts.embedModel ?? "gemini-embedding-001";
  const base = (opts.baseUrl ?? BASE).replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((i, init) => fetch(i, init));
  const timeoutMs = opts.timeoutMs ?? 45_000;

  async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch {
      throw new ModelError("model_unavailable", true, "network_or_timeout");
    } finally {
      clearTimeout(t);
    }
  }

  const parts = (ps: ContentPart[]) =>
    ps.map((p) => ("text" in p ? { text: p.text } : { inlineData: { mimeType: p.image.mime, data: toBase64(p.image.data) } }));

  function classify(status: number): ModelError {
    if (status === 429 || status >= 500) return new ModelError("model_unavailable", true, `http_${status}`);
    return new ModelError("model_output_invalid", false, `http_${status}`);
  }

  return {
    name: `gemini:${model}`,

    async generateJson(req: JsonRequest) {
      const full = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: parts(req.parts) }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: req.temperature ?? 0.2,
          ...(req.schema ? { responseJsonSchema: simplifySchema(req.schema) } : {}),
          ...(req.highResImages ? { mediaResolution: "MEDIA_RESOLUTION_HIGH" } : {}),
        },
      };
      let r = await post(`models/${model}:generateContent`, full);
      if (r.status === 400) {
        // Degrade once: drop optional features the model/version may not accept.
        r = await post(`models/${model}:generateContent`, {
          ...full,
          generationConfig: { responseMimeType: "application/json", temperature: req.temperature ?? 0.2 },
        });
      }
      if (r.status !== 200) throw classify(r.status);
      const cand = (r.json as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] })?.candidates?.[0];
      if (!cand) throw new ModelError("model_output_invalid", true, "no_candidate");
      if (cand.finishReason && !["STOP", "MAX_TOKENS"].includes(cand.finishReason)) {
        throw new ModelError("model_output_invalid", false, `finish_${cand.finishReason.toLowerCase()}`);
      }
      const text = (cand.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      try {
        return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        throw new ModelError("model_output_invalid", true, "not_json");
      }
    },

    async embed(texts, task) {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        const batch = texts.slice(i, i + 100);
        const r = await post(`models/${embedModel}:batchEmbedContents`, {
          requests: batch.map((text) => ({
            model: `models/${embedModel}`,
            content: { parts: [{ text: text.slice(0, 2000) }] },
            taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
            outputDimensionality: EMBEDDING_DIMS,
          })),
        });
        if (r.status !== 200) throw classify(r.status);
        const embs = (r.json as { embeddings?: { values?: number[] }[] })?.embeddings ?? [];
        if (embs.length !== batch.length) throw new ModelError("model_output_invalid", true, "embedding_count");
        for (const e of embs) {
          const v = e.values ?? [];
          if (v.length !== EMBEDDING_DIMS) throw new ModelError("model_output_invalid", false, "embedding_dims");
          const norm = Math.hypot(...v) || 1;
          out.push(v.map((x) => x / norm));
        }
      }
      return out;
    },
  };
}
