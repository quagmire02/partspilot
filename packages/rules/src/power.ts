import type { PowerMode } from "@partspilot/shared";
import type { Net, Netlist, Node, PlacedPart } from "./netlist";

export interface Source {
  key: string; // `${ref}.${pin}` (may be an unconnected, internal pin)
  ref: string;
  voltage: number;
  capacityMa: number;
  origin: "battery" | "usb" | "regulator";
}

export interface PowerState {
  sources: Source[];
  /** voltage of every powered pin key (connected or internal) */
  pinVoltage: Map<string, number>;
  netVoltage: Map<Net, number>;
  /** nets fed by more than one distinct source pin */
  shortedNets: { net: Net; sources: Source[] }[];
  /** extra demand from loads attributed straight to a net (contact-switched or always-on) */
  loadsOnNet: Map<Net, number>;
  /** load current through each driver_out node */
  loadsOnDriverOut: Map<string, number>;
  /** demand charged to a supply key (passes_load_current pins) */
  loadsOnKey: Map<string, number>;
  demandOfKey(key: string): number;
  voltageOf(ref: string, pin: string): number | undefined;
}

const EPS = 0.1;

export function analyzePower(nl: Netlist, mode: PowerMode): PowerState {
  const nodeAt = (ref: string, pin: string) => nl.nodes.get(`${ref}.${pin}`);
  const pinVoltage = new Map<string, number>();
  const netVoltage = new Map<Net, number>();
  const sources = new Map<string, Source>();

  const voltageOf = (ref: string, pin: string): number | undefined => {
    const node = nodeAt(ref, pin);
    if (node) {
      const net = nl.netOf.get(node.key)!;
      return netVoltage.get(net);
    }
    return pinVoltage.get(`${ref}.${pin}`);
  };

  const addSource = (s: Source) => {
    if (sources.has(s.key)) return false;
    sources.set(s.key, s);
    return true;
  };

  for (const part of nl.parts.values()) {
    const pr = part.profile;
    if (pr.role === "power_source" && pr.hazards.length === 0) {
      for (const pin of pr.pins) {
        if (pin.kind === "power_out" && pin.supply_v) {
          addSource({ key: `${part.ref}.${pin.name}`, ref: part.ref, voltage: pin.supply_v, capacityMa: pin.max_ma ?? Infinity, origin: "battery" });
        }
      }
    }
    if (mode === "usb" && pr.role === "mcu" && pr.usb_power) {
      addSource({ key: `${part.ref}.${pr.usb_power.supply_pin}`, ref: part.ref, voltage: 5, capacityMa: pr.usb_power.max_ma, origin: "usb" });
    }
  }

  // Fixed point: propagate source voltages to nets, then through regulators.
  for (let changed = true, rounds = 0; changed && rounds < 20; rounds++) {
    changed = false;
    for (const s of sources.values()) {
      const node = nl.nodes.get(s.key);
      if (node) {
        const net = nl.netOf.get(node.key)!;
        if (!netVoltage.has(net)) {
          netVoltage.set(net, s.voltage);
          changed = true;
        }
      } else if (!pinVoltage.has(s.key)) {
        pinVoltage.set(s.key, s.voltage);
        changed = true;
      }
    }
    for (const part of nl.parts.values()) {
      for (const reg of part.profile.regulators) {
        const vin = voltageOf(part.ref, reg.in_pin);
        if (vin === undefined) continue;
        const inPin = part.pinIndex.get(reg.in_pin.toLowerCase());
        if (inPin?.kind === "power_in" && inPin.range_v && (vin < inPin.range_v[0] - EPS || vin > inPin.range_v[1] + EPS)) continue;
        const outPin = part.pinIndex.get(reg.out_pin.toLowerCase());
        if (!outPin) continue;
        if (addSource({
          key: `${part.ref}.${outPin.name}`,
          ref: part.ref,
          voltage: outPin.supply_v ?? vin,
          capacityMa: outPin.max_ma ?? Infinity,
          origin: "regulator",
        })) changed = true;
      }
    }
  }

  const shortedNets: PowerState["shortedNets"] = [];
  const byNet = new Map<Net, Source[]>();
  for (const s of sources.values()) {
    const node = nl.nodes.get(s.key);
    if (!node) continue;
    const net = nl.netOf.get(node.key)!;
    byNet.set(net, [...(byNet.get(net) ?? []), s]);
  }
  for (const [net, ss] of byNet) if (ss.length > 1) shortedNets.push({ net, sources: ss });

  // --- loads -------------------------------------------------------------------
  const loadsOnNet = new Map<Net, number>();
  const loadsOnDriverOut = new Map<string, number>();
  const loadsOnKey = new Map<string, number>();
  const contactGroups = contactNetGroups(nl);

  for (const part of nl.parts.values()) {
    const load = part.profile.load;
    if (!load || !nl.connectedRefs.has(part.ref)) continue;
    const terminals = part.profile.pins
      .filter((p) => p.kind === "load")
      .map((p) => nodeAt(part.ref, p.name))
      .filter((n): n is Node => Boolean(n));
    const nets = terminals.map((t) => nl.netOf.get(t.key)!);
    let attributed = false;
    for (const net of nets) {
      for (const n of net.nodes) {
        if (n.pin.kind !== "driver_out") continue;
        loadsOnDriverOut.set(n.key, (loadsOnDriverOut.get(n.key) ?? 0) + load.current_ma);
        const supply = n.part.profile.passes_load_current[0];
        if (supply && !attributed) {
          const key = `${n.ref}.${supply}`;
          loadsOnKey.set(key, (loadsOnKey.get(key) ?? 0) + load.current_ma);
          attributed = true;
        }
      }
    }
    if (attributed) continue;
    const reachable = new Set(nets.flatMap((n) => [n, ...(contactGroups.get(n) ?? [])]));
    for (const net of reachable) {
      if (netVoltage.has(net) && !net.nodes.some((x) => x.pin.kind === "ground")) {
        loadsOnNet.set(net, (loadsOnNet.get(net) ?? 0) + load.current_ma);
        break;
      }
    }
  }

  // --- demand ------------------------------------------------------------------
  const selfDrawKey = new Map<string, string>(); // part ref → key charged with self draw
  for (const part of nl.parts.values()) {
    if (!nl.connectedRefs.has(part.ref) && part.profile.role !== "mcu") continue;
    const key = selfKey(part, mode, voltageOf);
    if (key) selfDrawKey.set(part.ref, key);
  }

  const memo = new Map<string, number>();
  const demandOfNet = (net: Net, seen: Set<string>): number => {
    let total = loadsOnNet.get(net) ?? 0;
    for (const n of net.nodes) total += keyLocalDemand(n.key, n.pin.kind === "power_in" ? (n.pin.draw_ma ?? 0) : 0, seen);
    return total;
  };
  const keyLocalDemand = (key: string, pinDraw: number, seen: Set<string>): number => {
    let total = pinDraw + (loadsOnKey.get(key) ?? 0);
    const [ref, pin] = splitKey(key);
    const part = nl.parts.get(ref)!;
    if (selfDrawKey.get(ref) === key) total += part.profile.self_draw_ma;
    for (const reg of part.profile.regulators) {
      if (reg.in_pin !== pin) continue;
      const outKey = `${ref}.${part.pinIndex.get(reg.out_pin.toLowerCase())?.name ?? reg.out_pin}`;
      // Only rails this regulator actually feeds (a USB-fed rail is not drawn from this input).
      if (sources.get(outKey)?.origin === "regulator") total += demandOfKey(outKey, seen);
    }
    return total;
  };
  const demandOfKey = (key: string, seen = new Set<string>()): number => {
    if (seen.has(key)) return 0;
    if (memo.has(key)) return memo.get(key)!;
    seen.add(key);
    const node = nl.nodes.get(key);
    const value = node ? demandOfNet(nl.netOf.get(node.key)!, seen) : keyLocalDemand(key, 0, seen);
    memo.set(key, value);
    return value;
  };

  return {
    sources: [...sources.values()],
    pinVoltage,
    netVoltage,
    shortedNets,
    loadsOnNet,
    loadsOnDriverOut,
    loadsOnKey,
    demandOfKey: (k) => demandOfKey(k),
    voltageOf,
  };
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(".");
  return [key.slice(0, i), key.slice(i + 1)];
}

/** MCUs on USB are charged to the USB rail; everything else to its first powered supply pin. */
function selfKey(part: PlacedPart, mode: PowerMode, voltageOf: (r: string, p: string) => number | undefined): string | null {
  const pr = part.profile;
  if (pr.self_draw_ma <= 0) return null;
  if (pr.role === "mcu" && mode === "usb" && pr.usb_power) return `${part.ref}.${pr.usb_power.supply_pin}`;
  const pin = pr.pins.find((p) => p.kind === "power_in" && voltageOf(part.ref, p.name) !== undefined);
  return pin ? `${part.ref}.${pin.name}` : null;
}

/** Nets joined by a relay's contacts (worst case: contacts closed). */
function contactNetGroups(nl: Netlist): Map<Net, Net[]> {
  const out = new Map<Net, Net[]>();
  for (const part of nl.parts.values()) {
    const nets = part.profile.pins
      .filter((p) => p.kind === "contact")
      .map((p) => nl.nodes.get(`${part.ref}.${p.name}`))
      .filter((n): n is Node => Boolean(n))
      .map((n) => nl.netOf.get(n.key)!);
    for (const a of nets) out.set(a, [...(out.get(a) ?? []), ...nets.filter((b) => b !== a)]);
  }
  return out;
}
