import { DETECT_SYSTEM, DISCOVERY_SYSTEM, INTENT_SYSTEM, PLAN_SYSTEM } from "./prompts";
import { EMBEDDING_DIMS, type JsonRequest, type ModelProvider } from "./provider";

/**
 * Deterministic stand-in for local development and tests (AI_PROVIDER=mock). Never used in
 * production config. Detection returns a typical RC-car parts pile; planning returns the
 * first reference project it was given, so the whole pipeline can run without a model.
 */
export function createMockProvider(overrides: Partial<Record<"detect" | "intent" | "plan" | "discovery", (req: JsonRequest) => unknown>> = {}): ModelProvider {
  const dataOf = (req: JsonRequest): Record<string, unknown> => {
    const text = req.parts.map((p) => ("text" in p ? p.text : "")).join("\n");
    const m = /<data>\n([\s\S]*)\n<\/data>/.exec(text);
    return m ? (JSON.parse(m[1]!) as Record<string, unknown>) : {};
  };
  return {
    name: "mock",
    async generateJson(req) {
      if (req.system === DETECT_SYSTEM) return overrides.detect?.(req) ?? MOCK_DETECTION;
      if (req.system === INTENT_SYSTEM) {
        if (overrides.intent) return overrides.intent(req);
        const goal = String(dataOf(req).goal ?? "");
        return { intent: goal.trim() ? "specific" : "discovery", goal_summary: goal.slice(0, 200), hazard: "none", language_hint: null };
      }
      if (req.system.startsWith(PLAN_SYSTEM)) {
        if (overrides.plan) return overrides.plan(req);
        const refs = (dataOf(req).references ?? []) as { plan: unknown }[];
        if (refs[0]) return refs[0].plan;
        return { error: "no reference" };
      }
      if (req.system === DISCOVERY_SYSTEM) return overrides.discovery?.(req) ?? { invalid: true };
      return {};
    },
    async embed(texts) {
      return texts.map(hashEmbedding);
    },
  };
}

/** Character-trigram hashing embedding: stable, cheap, roughly similarity-preserving. */
export function hashEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  for (let i = 0; i + 3 <= t.length; i++) {
    let h = 2166136261;
    for (let j = i; j < i + 3; j++) h = Math.imul(h ^ t.charCodeAt(j), 16777619);
    v[(h >>> 0) % EMBEDDING_DIMS]! += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export const MOCK_DETECTION = {
  image_quality: "ok",
  items: [
    { label: "Arduino Uno R3", box_2d: [80, 60, 420, 420], confidence: 0.95, visible_text: ["UNO", "ARDUINO"], quantity: 1 },
    { label: "L298N motor driver module", box_2d: [90, 480, 380, 760], confidence: 0.93, visible_text: ["L298N"], quantity: 1 },
    { label: "TT DC gear motor", box_2d: [480, 60, 700, 300], confidence: 0.9, visible_text: [], quantity: 2 },
    { label: "HC-05 Bluetooth module", box_2d: [470, 420, 640, 560], confidence: 0.88, visible_text: ["HC-05"], quantity: 1 },
    { label: "2x18650 battery holder", box_2d: [700, 520, 950, 950], confidence: 0.86, visible_text: [], quantity: 1 },
  ],
};
