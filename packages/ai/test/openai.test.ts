import { describe, expect, it } from "vitest";
import { createOpenAiCompatProvider, extractJson, ModelError, providerFromConfig } from "../src";

function fakeFetch(handler: (url: string, body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body, auth: new Headers(init.headers).get("authorization") });
    const r = handler(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const vec = (n: number, x = 1) => Array.from({ length: n }, () => x);

describe("OpenAI-compatible provider (Ollama, LM Studio, OpenAI…)", () => {
  it("sends images as data URLs, asks for schema JSON, no tools, and parses the reply", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, json: { choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] } }));
    const p = createOpenAiCompatProvider({ baseUrl: "http://127.0.0.1:11434/v1/", model: "qwen2.5vl:7b", embedModel: "nomic-embed-text", fetch: f });
    const out = await p.generateJson({ system: "sys", parts: [{ text: "hi" }, { image: { mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) } }], schema: { type: "object" } });
    expect(out).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(calls[0]!.auth).toBeNull();
    const body = calls[0]!.body as { messages: { content: unknown }[]; response_format: { type: string }; tools?: unknown };
    expect(body.response_format.type).toBe("json_schema");
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages[1]!.content)).toContain("data:image/jpeg;base64,AQID");
  });

  it("falls back to plain JSON mode when the server rejects schemas", async () => {
    const { f, calls } = fakeFetch((_u, b) =>
      (b.response_format as { type: string }).type === "json_schema"
        ? { status: 400, json: {} }
        : { status: 200, json: { choices: [{ message: { content: 'Sure! ```json\n{"a":1}\n```' }, finish_reason: "stop" }] } },
    );
    const p = createOpenAiCompatProvider({ baseUrl: "http://x/v1", apiKey: "k", model: "m", embedModel: "e", fetch: f });
    expect(await p.generateJson({ system: "s", parts: [{ text: "t" }], schema: {} })).toEqual({ a: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.auth).toBe("Bearer k");
  });

  it("embeds with task prefixes for nomic, normalises, and checks dimensions", async () => {
    const { f, calls } = fakeFetch((_u, b) => ({ status: 200, json: { data: (b.input as string[]).map((_, index) => ({ index, embedding: vec(768, 2) })) } }));
    const p = createOpenAiCompatProvider({ baseUrl: "http://x/v1", model: "m", embedModel: "nomic-embed-text", fetch: f });
    const [v] = await p.embed(["Arduino Uno"], "query");
    expect(Math.hypot(...v!)).toBeCloseTo(1);
    expect((calls[0]!.body.input as string[])[0]).toBe("search_query: Arduino Uno");

    const bad = fakeFetch(() => ({ status: 200, json: { data: [{ index: 0, embedding: vec(1024) }] } }));
    const q = createOpenAiCompatProvider({ baseUrl: "http://x/v1", model: "m", embedModel: "mxbai", fetch: bad.f });
    await expect(q.embed(["a"], "document")).rejects.toThrow(/embedding_dims_1024_need_768/);
  });

  it("uses a separate embeddings endpoint when configured", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, json: { data: [{ index: 0, embedding: vec(768) }] } }));
    const p = createOpenAiCompatProvider({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "g", model: "m", embedModel: "nomic-embed-text", embedBaseUrl: "http://127.0.0.1:11434/v1", fetch: f });
    await p.embed(["a"], "document");
    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/v1/embeddings");
    expect(calls[0]!.auth).toBeNull();
  });

  it("maps HTTP errors to retryable / permanent model errors", async () => {
    for (const [status, retryable] of [[429, true], [503, true], [404, false], [401, false]] as const) {
      const { f } = fakeFetch(() => ({ status, json: {} }));
      const p = createOpenAiCompatProvider({ baseUrl: "http://x/v1", model: "m", embedModel: "e", fetch: f });
      const err = await p.generateJson({ system: "s", parts: [{ text: "t" }] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelError);
      expect((err as ModelError).retryable).toBe(retryable);
    }
  });

  it("extracts JSON from chatty replies", () => {
    expect(extractJson('Here you go: {"x":[1,2]} hope it helps')).toEqual({ x: [1, 2] });
    expect(() => extractJson("no json here")).toThrow(ModelError);
  });
});

describe("providerFromConfig", () => {
  it("selects the provider and reports missing settings instead of calling out", async () => {
    expect(providerFromConfig({ AI_PROVIDER: "mock" }).name).toBe("mock");
    expect(providerFromConfig({ AI_PROVIDER: "openai", OPENAI_BASE_URL: "http://x/v1", OPENAI_MODEL: "m", OPENAI_EMBED_MODEL: "e" }).name).toBe("openai:m");
    expect(providerFromConfig({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" }).name).toMatch(/^gemini:/);
    const missing = providerFromConfig({ AI_PROVIDER: "openai" });
    await expect(missing.embed(["a"], "query")).rejects.toThrow(/missing_openai_config/);
  });
});
