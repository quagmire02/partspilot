import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEngine, createGeminiProvider } from "../src/index";
import { memoryCatalog } from "./support";

/**
 * Real Gemini calls. Skipped unless GEMINI_API_KEY is set.
 *   GEMINI_API_KEY=… pnpm --filter @partspilot/ai test -- live
 *   E2E_PHOTO=path/to/pile.jpg also runs detection on a real photo.
 */
const key = process.env.GEMINI_API_KEY;

describe.runIf(Boolean(key))("live Gemini", () => {
  const provider = createGeminiProvider({ apiKey: key!, model: process.env.GEMINI_MODEL, embedModel: process.env.GEMINI_EMBED_MODEL });
  const engine = createEngine({ provider, catalog: memoryCatalog() });

  it("plans a validated RC car from a typical parts pile", async () => {
    const t0 = Date.now();
    const { payload } = await engine.plan({
      goal: "Can I build an RC car?",
      planVersion: 0,
      parts: [
        { part_id: "arduino-uno-r3", quantity: 1 },
        { part_id: "l298n-motor-driver", quantity: 1 },
        { part_id: "tt-dc-gear-motor", quantity: 2 },
        { part_id: "hc-05-bluetooth", quantity: 1 },
        { part_id: "battery-holder-2x18650", quantity: 1 },
      ],
    });
    const p = payload.plans[0]!;
    console.log(`live plan: ${p.title} · ${p.verdict} · attempts ${p.validation.attempts} · ${Date.now() - t0} ms`);
    if (!p.validation.passed) console.log(p.validation.issues.map((i) => `${i.code}: ${i.message}`).join("\n"));
    expect(p.validation.passed).toBe(true);
    expect(p.code?.source.length).toBeGreaterThan(200);
  }, 180_000);

  it.runIf(Boolean(process.env.E2E_PHOTO))("detects parts in a real photo", async () => {
    const bytes = new Uint8Array(readFileSync(process.env.E2E_PHOTO!));
    const [det] = await engine.detect([{ index: 0, bytes, mime: "image/jpeg" }]);
    console.log(det!.items.map((i) => `${i.label} (${i.confidence}) [${i.visible_text.join(", ")}]`).join("\n"));
    expect(det!.items.length).toBeGreaterThan(0);
  }, 120_000);
});
