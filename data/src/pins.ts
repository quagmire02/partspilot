import type { CatalogPartInput, PinCap, PinReservation, PinSpecInput } from "@partspilot/shared";

type Extra = Partial<PinSpecInput>;

/** MCU GPIO. 5 V parts tolerate 5.5 V; 3.3 V parts tolerate 3.6 V (not 5 V tolerant). */
export const gpio = (name: string, v: 5 | 3.3, ma: number, caps: PinCap[] = [], extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "gpio",
  logic_v: v,
  max_in_v: v === 5 ? 5.5 : 3.6,
  max_ma: ma,
  caps: ["digital", ...caps],
  ...extra,
});

export const input = (name: string, maxIn: number, extra: Extra = {}): PinSpecInput => ({ name, kind: "input", max_in_v: maxIn, ...extra });
export const output = (name: string, logicV: number, extra: Extra = {}): PinSpecInput => ({ name, kind: "output", logic_v: logicV, ...extra });
/** Output whose level follows the module supply (3.3 V or 5 V depending on VCC). */
export const outputFrom = (name: string, supplyPin: string, extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "output",
  out_v_from: supplyPin,
  ...extra,
});
export const analogFrom = (name: string, supplyPin: string, extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "analog_out",
  out_v_from: supplyPin,
  requires: ["adc"],
  ...extra,
});
export const bidir = (name: string, logicV: number, maxIn: number, extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "bidir",
  logic_v: logicV,
  max_in_v: maxIn,
  ...extra,
});
export const bidirFrom = (name: string, supplyPin: string, maxIn: number, extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "bidir",
  out_v_from: supplyPin,
  max_in_v: maxIn,
  ...extra,
});
export const pwrIn = (name: string, range: [number, number], drawMa: number, extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "power_in",
  range_v: range,
  draw_ma: drawMa,
  ...extra,
});
export const pwrOut = (name: string, v: number, maxMa: number, extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "power_out",
  supply_v: v,
  max_ma: maxMa,
  ...extra,
});
export const gnd = (name = "GND", extra: Extra = {}): PinSpecInput => ({ name, kind: "ground", ...extra });
export const driverOut = (name: string, maxMa: number, supplyPin?: string, extra: Extra = {}): PinSpecInput => ({
  name,
  kind: "driver_out",
  max_ma: maxMa,
  ...(supplyPin ? { out_v_from: supplyPin } : {}),
  ...extra,
});
export const load = (name: string, extra: Extra = {}): PinSpecInput => ({ name, kind: "load", ...extra });
export const passive = (name: string, extra: Extra = {}): PinSpecInput => ({ name, kind: "passive", ...extra });
export const contact = (name: string, extra: Extra = {}): PinSpecInput => ({ name, kind: "contact", ...extra });
export const nc = (name: string, extra: Extra = {}): PinSpecInput => ({ name, kind: "nc", ...extra });

export const reserved = (reason: PinReservation["reason"], blocked: PinReservation["blocked"], note: string): { reserved: PinReservation } => ({
  reserved: { reason, blocked, note },
});

export const i2c = { bus: "i2c" as const };

/**
 * Adds the exact name as an alias and drops pin aliases that only differ from the pin
 * name by case (pin matching is case-insensitive).
 */
export function part(p: Omit<CatalogPartInput, "source"> & Partial<Pick<CatalogPartInput, "source">>): CatalogPartInput {
  const aliases = new Set([p.name, ...(p.aliases ?? [])]);
  // People (and detectors) type "2x18650", not "2×18650".
  for (const a of [...aliases]) if (/[×Ω]/.test(a)) aliases.add(a.replace(/×/g, "x").replace(/Ω/g, " ohm"));
  const profile = p.profile
    ? {
        ...p.profile,
        pins: p.profile.pins.map((pin) => {
          const seen = new Set([pin.name.toLowerCase()]);
          const kept = (pin.aliases ?? []).filter((a) => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
          return { ...pin, aliases: kept };
        }),
      }
    : p.profile;
  return { source: "curated", license: "CC-BY-SA-4.0", ...p, aliases: [...aliases], profile };
}
