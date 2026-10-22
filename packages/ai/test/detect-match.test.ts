import { describe, expect, it } from "vitest";
import { calibrate, createMockProvider, detectImage, matchItems, modelTokens, scoreCandidates, screenGoal, toImageDetection } from "../src/index";
import type { CatalogMatchRow } from "../src/catalog";
import { memoryCatalog } from "./support";

describe("detection", () => {
  it("converts Gemini [ymin,xmin,ymax,xmax]/1000 boxes and sanitizes text", () => {
    const d = toImageDetection(
      {
        image_quality: "ok",
        items: [
          { label: "L298N\u0007 module", box_2d: [100, 200, 300, 600], confidence: 0.9, visible_text: ["L298N", "x".repeat(80)], quantity: 1 },
          { label: "speck", box_2d: [10, 10, 11, 11], confidence: 0.9, visible_text: [], quantity: 1 },
        ],
      },
      2,
    );
    expect(d.image_index).toBe(2);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.bbox).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
    expect(d.items[0]!.label).toBe("L298N  module");
    expect(d.items[0]!.visible_text[1]!.length).toBe(60);
  });

  it("retries once on schema-invalid output, then fails permanently", async () => {
    let n = 0;
    const p = createMockProvider({ detect: () => (n++ === 0 ? { nope: 1 } : { image_quality: "ok", items: [] }) });
    expect((await detectImage(p, { index: 0, bytes: new Uint8Array([1]), mime: "image/jpeg" })).items).toEqual([]);
    const bad = createMockProvider({ detect: () => ({ nope: 1 }) });
    await expect(detectImage(bad, { index: 0, bytes: new Uint8Array([1]), mime: "image/jpeg" })).rejects.toMatchObject({
      code: "model_output_invalid",
      retryable: false,
    });
  });
});

describe("matcher", () => {
  it("extracts model-number tokens and ignores units", () => {
    expect(modelTokens(["L298N motor driver", "HC-SR04", "28BYJ-48 5V", "100uF", "12V", "ESP32-WROOM-32"]).sort()).toEqual(
      ["28BYJ48", "ESP32WROOM32", "HCSR04", "L298N"].sort(),
    );
  });

  const row = (part_id: string, name: string, alias: string, trgm: number, vec = 0, has_profile = true): CatalogMatchRow => ({
    part_id,
    name,
    alias,
    trgm_sim: trgm,
    vec_sim: vec,
    has_profile,
  });

  it("auto-accepts a printed model number with a clear margin", () => {
    const scored = scoreCandidates(
      [row("l298n-motor-driver", "L298N Dual H-Bridge Motor Driver Module", "L298N", 1), row("fz-drv8825", "DRV 8825 Stepper Motor Carrier", "motor driver", 0.95, 0, false)],
      ["L298N"],
      false,
      new Set(),
    );
    const [top, second] = calibrate(scored, 0.93);
    expect(top!.part_id).toBe("l298n-motor-driver");
    expect(top!.score).toBeGreaterThanOrEqual(0.85);
    expect(second!.score).toBeLessThan(top!.score);
  });

  it("asks the user when two candidates tie on generic words", () => {
    const scored = scoreCandidates(
      [row("l298n-motor-driver", "L298N Dual H-Bridge Motor Driver Module", "motor driver board", 0.8), row("fz-drv8825", "DRV 8825 Stepper Motor Carrier", "motor driver", 0.78, 0, false)],
      [],
      false,
      new Set(),
    );
    expect(calibrate(scored, 0.9)[0]!.score).toBeLessThan(0.85);
  });

  it("returns at most 3 candidates per item and survives embedding failures", async () => {
    const rows = [
      row("hc-sr04-ultrasonic", "HC-SR04 Ultrasonic Distance Sensor", "HC-SR04", 1),
      row("hc-sr501-pir", "HC-SR501 PIR Motion Sensor", "HC-SR501", 0.5),
      row("hc-05-bluetooth", "HC-05 Bluetooth Serial Module", "HC-05", 0.4),
      row("hc-06-bluetooth", "HC-06 Bluetooth Serial Module", "HC-06", 0.35),
    ];
    const provider = { ...createMockProvider(), embed: async () => Promise.reject(new Error("down")) };
    const [cands] = await matchItems([{ label: "ultrasonic sensor", visible_text: ["HC-SR04"], confidence: 0.9 }], memoryCatalog(rows), provider);
    expect(cands).toHaveLength(3);
    expect(cands![0]!.part_id).toBe("hc-sr04-ultrasonic");
    expect(cands![0]!.score).toBeGreaterThanOrEqual(0.85);
  });
});

describe("goal screening", () => {
  it.each([
    ["Can I build an RC car?", "none", false],
    ["", "none", true],
    ["what can I build with these?", "none", true],
    ["a stun gun for self defence", "weapon", false],
    ["build a coilgun", "weapon", false],
    ["stand for my hot glue gun with a fan", "none", false],
    ["robot with a kill switch", "none", false],
    ["smart switch for my 230V wall outlet", "mains", false],
    ["Tesla coil music", "high_voltage", false],
  ])("%j → hazard %s, discovery %s", (goal, hazard, discovery) => {
    expect(screenGoal(goal)).toEqual({ hazard, discovery });
  });
});
