import { simplifySchema } from "./gemini";
import { EMBEDDING_DIMS, ModelError, type ContentPart, type ModelProvider } from "./provider";

export interface OpenAiCompatOptions {
  /** e.g. http://127.0.0.1:11434/v1 (Ollama), http://127.0.0.1:1234/v1 (LM Studio), https://api.openai.com/v1 */
  baseUrl: string;
  apiKey?: string;
  /** Vision-capable chat model. */
  model: string;
  /** Must produce 768-dim vectors (or honour `dimensions`), e.g. nomic-embed-text, text-embedding-3-small. */
  embedModel: string;
  /** Separate endpoint for embeddings when the chat API has none (e.g. Groq + local Ollama). */
  embedBaseUrl?: string;
  embedApiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Small local models sometimes wrap JSON in prose or fences; take the outermost object. */
export function extractJson(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start < 0 || end <= start) throw new ModelError("model_output_invalid", true, "not_json");
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      throw new ModelError("model_output_invalid", true, "not_json");
    }
  }
}

/** Any OpenAI-compatible chat + embeddings API: Ollama, LM Studio, OpenAI, Groq, OpenRouter… */
export function createOpenAiCompatProvider(opts: OpenAiCompatOptions): ModelProvider {
  const doFetch = opts.fetch ?? ((i, init) => fetch(i, init));
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const nomic = /nomic/i.test(opts.embedModel);

  async function post(base: string, key: string | undefined, path: string, body: unknown) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base.replace(/\/+$/, "")}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
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

  function classify(status: number): ModelError {
    if (status === 429 || status >= 500) return new ModelError("model_unavailable", true, `http_${status}`);
    if (status === 401 || status === 403 || status === 404) return new ModelError("model_unavailable", false, `http_${status}`);
    return new ModelError("model_output_invalid", false, `http_${status}`);
  }

  const content = (ps: ContentPart[]) =>
    ps.map((p) =>
      "text" in p
        ? { type: "text", text: p.text }
        : { type: "image_url", image_url: { url: `data:${p.image.mime};base64,${toBase64(p.image.data)}` } },
    );

  return {
    name: `openai:${opts.model}`,

    async generateJson(req) {
      const base = {
        model: opts.model,
        temperature: req.temperature ?? 0.2,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: content(req.parts) },
        ],
      };
      const format = req.schema
        ? { type: "json_schema", json_schema: { name: "output", schema: simplifySchema(req.schema) } }
        : { type: "json_object" };
      let r = await post(opts.baseUrl, opts.apiKey, "chat/completions", { ...base, response_format: format });
      if (r.status === 400) r = await post(opts.baseUrl, opts.apiKey, "chat/completions", { ...base, response_format: { type: "json_object" } });
      if (r.status !== 200) throw classify(r.status);
      const choice = (r.json as { choices?: { message?: { content?: string }; finish_reason?: string }[] })?.choices?.[0];
      if (!choice) throw new ModelError("model_output_invalid", true, "no_candidate");
      if (choice.finish_reason && !["stop", "length"].includes(choice.finish_reason)) {
        throw new ModelError("model_output_invalid", false, `finish_${choice.finish_reason}`);
      }
      return extractJson(choice.message?.content ?? "");
    },

    async embed(texts, task) {
      if (texts.length === 0) return [];
      const base = opts.embedBaseUrl ?? opts.baseUrl;
      const key = opts.embedBaseUrl ? opts.embedApiKey : (opts.embedApiKey ?? opts.apiKey);
      const prefix = nomic ? (task === "query" ? "search_query: " : "search_document: ") : "";
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 64) {
        const input = texts.slice(i, i + 64).map((t) => prefix + t.slice(0, 2000));
        let r = await post(base, key, "embeddings", { model: opts.embedModel, input, dimensions: EMBEDDING_DIMS });
        if (r.status === 400) r = await post(base, key, "embeddings", { model: opts.embedModel, input });
        if (r.status !== 200) throw classify(r.status);
        const data = ((r.json as { data?: { embedding?: number[]; index?: number }[] })?.data ?? []).slice();
        if (data.length !== input.length) throw new ModelError("model_output_invalid", true, "embedding_count");
        data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        for (const d of data) {
          const v = d.embedding ?? [];
          if (v.length !== EMBEDDING_DIMS) throw new ModelError("model_output_invalid", false, `embedding_dims_${v.length}_need_${EMBEDDING_DIMS}`);
          const norm = Math.hypot(...v) || 1;
          out.push(v.map((x) => x / norm));
        }
      }
      return out;
    },
  };
}
