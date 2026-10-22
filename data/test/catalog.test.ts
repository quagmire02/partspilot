import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogPart, PartProfile } from "@partspilot/shared";
import { CURATED_BY_ID, CURATED_PARTS, KICAD_REFS, WOKWI_PINS } from "../src/index";

const profile = (p: CatalogPart): PartProfile => p.profile!;
const pinNames = (p: CatalogPart) => new Set(profile(p).pins.flatMap((x) => [x.name, ...x.aliases]));

describe("curated catalog integrity", () => {
  it("has unique ids and a profile on every part", () => {
    expect(new Set(CURATED_PARTS.map((p) => p.id)).size).toBe(CURATED_PARTS.length);
    expect(CURATED_PARTS.length).toBeGreaterThanOrEqual(80);
    for (const p of CURATED_PARTS) expect(p.profile, p.id).not.toBeNull();
  });

  it("has unique pin names and aliases within each part", () => {
    for (const p of CURATED_PARTS) {
      const seen = new Map<string, string>();
      for (const pin of profile(p).pins) {
        for (const n of [pin.name, ...pin.aliases]) {
          const key = n.toLowerCase();
          expect(seen.get(key), `${p.id}: ${n} on ${pin.name} and ${seen.get(key)}`).toBeUndefined();
          seen.set(key, pin.name);
        }
      }
    }
  });

  it("only references pins that exist", () => {
    for (const p of CURATED_PARTS) {
      const pr = profile(p);
      const names = new Set(pr.pins.map((x) => x.name));
      const refs = [
        ...pr.bridges.flat(),
        ...pr.passes_load_current,
        ...pr.regulators.flatMap((r) => [r.in_pin, r.out_pin]),
        ...(pr.usb_power ? [pr.usb_power.supply_pin] : []),
        ...pr.pins.flatMap((x) => (x.out_v_from ? [x.out_v_from] : [])),
      ];
      for (const r of refs) expect(names.has(r), `${p.id} references missing pin ${r}`).toBe(true);
    }
  });

  it("gives every electrical role the data the rules need", () => {
    for (const p of CURATED_PARTS) {
      const pr = profile(p);
      for (const pin of pr.pins) {
        const where = `${p.id}.${pin.name}`;
        if (pin.kind === "gpio") expect(pin.logic_v && pin.max_in_v && pin.max_ma, where).toBeTruthy();
        if (pin.kind === "input" || pin.kind === "bidir") expect(pin.max_in_v, where).toBeTruthy();
        if (pin.kind === "output" || pin.kind === "analog_out" || pin.kind === "bidir") {
          expect(pin.logic_v ?? pin.out_v_from, where).toBeTruthy();
        }
        if (pin.kind === "power_in") expect(pin.range_v, where).toBeTruthy();
        if (pin.kind === "power_out") expect(pin.supply_v && pin.max_ma, where).toBeTruthy();
        if (pin.kind === "driver_out") expect(pin.max_ma, where).toBeTruthy();
      }
      if (pr.role === "mcu") {
        expect(pr.languages.length, p.id).toBeGreaterThan(0);
        expect(pr.usb_power, p.id).toBeTruthy();
      }
      if (pr.pins.some((x) => x.kind === "load")) expect(pr.load, `${p.id} has load pins but no load spec`).toBeTruthy();
      if (pr.role === "power_source" && !pr.hazards.length) expect(pr.pins.some((x) => x.kind === "power_out"), p.id).toBe(true);
    }
  });

  it("maps every wokwi element to pins the element actually has", () => {
    for (const p of CURATED_PARTS) {
      const w = profile(p).wokwi;
      if (!w) continue;
      const elementPins = WOKWI_PINS[w.element];
      expect(elementPins, `${p.id}: unknown element ${w.element}`).toBeDefined();
      for (const pin of profile(p).pins) {
        if (pin.kind === "nc") continue;
        const target = w.pin_map[pin.name] ?? pin.name;
        expect(elementPins, `${p.id}.${pin.name} → ${target}`).toContain(target);
      }
    }
  });

  it("resolves kits to real parts", () => {
    for (const p of CURATED_PARTS) for (const k of profile(p).kit) expect(CURATED_BY_ID.has(k.part_id), `${p.id} kit ${k.part_id}`).toBe(true);
  });

  it("marks hazards on parts the rule engine must refuse", () => {
    expect(profile(CURATED_BY_ID.get("mains-power-cord")!).hazards).toContain("mains");
    expect(profile(CURATED_BY_ID.get("high-voltage-arc-generator")!).hazards).toContain("weapon");
    expect(profile(CURATED_BY_ID.get("tp4056-charger-basic")!).charger?.protection).toBe(false);
  });
});

describe("KiCad cross-check", () => {
  const kicad = JSON.parse(readFileSync(new URL("../generated/kicad-pins.json", import.meta.url), "utf8")) as {
    symbols: Record<string, { name: string; type: string }[]>;
  };
  const IGNORE = /^(NC|AREF|IOREF|AGND|ADC_VREF|3V3_EN|RUN|PGND\d*|VM[23])$/i;
  const norm = (s: string) => s.replace(/^\+/, "").replace(/\s+/g, "").toUpperCase();

  it.each(Object.entries(KICAD_REFS))("%s agrees with %s", (partId, ref) => {
    const p = CURATED_BY_ID.get(partId)!;
    const pins = profile(p).pins;
    const find = (kName: string) => {
      const options = kName.split("/").map(norm);
      return pins.find((x) => [x.name, ...x.aliases].some((n) => options.includes(norm(n)) || options.includes(norm(n).replace(/^D(?=\d)/, "D"))));
    };
    const problems: string[] = [];
    for (const k of kicad.symbols[ref]!) {
      if (IGNORE.test(k.name) || k.type === "no_connect") continue;
      const isGround = /GND/i.test(k.name);
      const mine = find(k.name.replace(/^GPIO(\d+)_ADC\d$/, "GPIO$1"));
      if (!mine) {
        problems.push(`missing ${k.name}`);
        continue;
      }
      const ok = isGround
        ? mine.kind === "ground"
        : k.type === "power_out"
          ? mine.kind === "power_out" || (mine.kind === "power_in" && /VBUS/i.test(k.name))
          : k.type === "power_in"
            ? mine.kind === "power_in"
            : k.type === "input"
              ? mine.kind === "input" || mine.kind === "gpio"
              : k.type === "output"
                ? mine.kind === "output" || mine.kind === "driver_out"
                : k.type === "bidirectional"
                  ? mine.kind === "gpio" || mine.kind === "bidir"
                  : true;
      if (!ok) problems.push(`${k.name}: kicad ${k.type} vs ${mine.kind}`);
    }
    expect(problems).toEqual([]);
  });
});
