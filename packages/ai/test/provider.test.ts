import { describe, expect, it } from "vitest";
import { createGeminiProvider, ModelError, simplifySchema } from "../src/index";

type Call = { url: string; body: Record<string, any>; headers: Headers };

function fakeFetch(responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const r = responses.shift()!;
    return typeof r === "function" ? r() : r;
  };
  return { f, calls };
}

const ok = (text: string, finishReason = "STOP") =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }), { status: 200 });

describe("gemini provider", () => {
  it("sends system + image as data, JSON schema, no tools, key in header", async () => {
    const { f, calls } = fakeFetch([ok('{"a":1}')]);
    const p = createGeminiProvider({ apiKey: "k-123", model: "gemini-test", fetch: f });
    const out = await p.generateJson({
      system: "SYS",
      parts: [{ image: { mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) } }, { text: "hi" }],
      schema: { type: "object", properties: { a: { type: "string", pattern: "x", minLength: 2 } } },
      highResImages: true,
    });
    expect(out).toEqual({ a: 1 });
    const c = calls[0]!;
    expect(c.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(c.url).not.toContain("k-123");
    expect(c.headers.get("x-goog-api-key")).toBe("k-123");
    expect(c.body.tools).toBeUndefined();
    expect(c.body.toolConfig).toBeUndefined();
    expect(c.body.systemInstruction.parts[0].text).toBe("SYS");
    expect(c.body.contents[0].parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: "AQID" });
    expect(c.body.generationConfig.responseJsonSchema.properties.a).toEqual({ type: "string" });
    expect(c.body.generationConfig.mediaResolution).toBe("MEDIA_RESOLUTION_HIGH");
  });

  it("degrades once on 400 by dropping optional features", async () => {
    const { f, calls } = fakeFetch([new Response("{}", { status: 400 }), ok("```json\n[1,2]\n```")]);
    const p = createGeminiProvider({ apiKey: "k", fetch: f });
    expect(await p.generateJson({ system: "s", parts: [{ text: "t" }], schema: { type: "array" } })).toEqual([1, 2]);
    expect(calls[1]!.body.generationConfig).toEqual({ responseMimeType: "application/json", temperature: 0.2 });
  });

  it.each([
    [429, true, "model_unavailable"],
    [503, true, "model_unavailable"],
    [403, false, "model_output_invalid"],
  ])("maps HTTP %i to retryable=%s", async (status, retryable, code) => {
    const { f } = fakeFetch([new Response("{}", { status }), new Response("{}", { status })]);
    const err = await createGeminiProvider({ apiKey: "k", fetch: f })
      .generateJson({ system: "s", parts: [{ text: "t" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err).toMatchObject({ code, retryable });
  });

  it("treats safety blocks as permanent and non-JSON as retryable", async () => {
    const blocked = await createGeminiProvider({ apiKey: "k", fetch: fakeFetch([ok("{}", "SAFETY")]).f })
      .generateJson({ system: "s", parts: [{ text: "t" }] })
      .catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: "model_output_invalid", retryable: false });
    const prose = await createGeminiProvider({ apiKey: "k", fetch: fakeFetch([ok("Sure! Here is")]).f })
      .generateJson({ system: "s", parts: [{ text: "t" }] })
      .catch((e: unknown) => e);
    expect(prose).toMatchObject({ code: "model_output_invalid", retryable: true });
  });

  it("embeds in batches with 768 dims and normalizes vectors", async () => {
    const vec = Array.from({ length: 768 }, (_, i) => (i === 0 ? 3 : i === 1 ? 4 : 0));
    const { f, calls } = fakeFetch([new Response(JSON.stringify({ embeddings: [{ values: vec }, { values: vec }] }))]);
    const [a] = await createGeminiProvider({ apiKey: "k", fetch: f }).embed(["x", "y"], "query");
    expect(a![0]).toBeCloseTo(0.6);
    expect(a![1]).toBeCloseTo(0.8);
    expect(calls[0]!.body.requests[0]).toMatchObject({ taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 });
  });

  it("strips keywords the constrained decoder may reject", () => {
    expect(simplifySchema({ $schema: "x", type: "object", properties: { s: { type: "string", format: "uri", maxLength: 3 } } })).toEqual({
      type: "object",
      properties: { s: { type: "string" } },
    });
  });
});
