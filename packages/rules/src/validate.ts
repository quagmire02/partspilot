import {
  REFUSAL_CODES,
  type CatalogPart,
  type Connection,
  type Issue,
  type IssueCode,
  type PinRef,
  type PowerMode,
  type ValidationReport,
} from "@partspilot/shared";
import { buildNetlist, indexPins, isConductivePassive, partLabel, pinLabel, type Net, type Netlist, type Node, type PlacedPart, type PlanPart } from "./netlist";
import { analyzePower, type PowerState } from "./power";

export interface ValidateInput {
  parts: PlanPart[];
  connections: Connection[];
  power_mode: PowerMode;
}

export type CatalogLookup = (partId: string) => CatalogPart | undefined;

const EPS = 0.1;
const LOGIC_KINDS = new Set(["gpio", "input", "output", "analog_out", "bidir"]);

class Issues {
  list: Issue[] = [];
  private seen = new Set<string>();
  add(code: IssueCode, message: string, o: { parts?: string[]; pins?: PinRef[]; hint?: string } = {}) {
    const key = `${code}|${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({
      code,
      severity: REFUSAL_CODES.includes(code) ? "refuse" : "block",
      message: message.slice(0, 400),
      parts: o.parts ?? [],
      pins: o.pins ?? [],
      ...(o.hint ? { hint: o.hint.slice(0, 400) } : {}),
    });
  }
}

const ref = (n: Node): PinRef => ({ ref: n.ref, pin: n.pin.name });
const fmtV = (v: number) => `${Number(v.toFixed(2))} V`;

/**
 * Validates a plan's wiring. Every rule blocks; refusal rules also stop the repair loop.
 * Pure function: same input, same report.
 */
export function validatePlan(input: ValidateInput, catalog: CatalogLookup): ValidationReport {
  const issues = new Issues();

  // ---- structure ---------------------------------------------------------------
  const parts = new Map<string, PlacedPart>();
  for (const p of input.parts) {
    if (parts.has(p.ref)) {
      issues.add("duplicate_ref", `Reference ${p.ref} is used for more than one part.`, { hint: "Give every part a unique ref." });
      continue;
    }
    const cat = catalog(p.part_id);
    if (!cat) {
      issues.add("unknown_part", `Part id "${p.part_id}" (${p.ref}) is not in the catalog.`, {
        parts: [p.ref],
        hint: "Use only part_id values from the allowed parts list.",
      });
      continue;
    }
    if (!cat.profile) {
      issues.add("part_without_profile", `${p.ref} (${cat.name}) has no electrical data, so its wiring cannot be checked.`, {
        parts: [p.ref],
        hint: "Replace it with a part from the allowed parts list or leave it out.",
      });
      continue;
    }
    parts.set(p.ref, { ref: p.ref, part: cat, profile: cat.profile, pinIndex: indexPins(cat.profile) });
  }
  const declared = new Set(input.parts.map((p) => p.ref));
  for (const c of input.connections) {
    for (const end of [c.from, c.to]) {
      const part = parts.get(end.ref);
      if (!part) {
        if (!declared.has(end.ref)) {
          issues.add("unknown_ref", `Connection uses ${end.ref}, which is not in the parts list.`, { pins: [end], hint: "Declare every ref in parts." });
        }
        continue;
      }
      if (!part.pinIndex.has(end.pin.toLowerCase())) {
        const valid = part.profile.pins.filter((x) => x.kind !== "nc").map((x) => x.name).join(", ");
        issues.add("unknown_pin", `${part.part.name} (${end.ref}) has no pin "${end.pin}".`, {
          parts: [end.ref],
          pins: [end],
          hint: `Valid pins for ${end.ref}: ${valid}`.slice(0, 400),
        });
      }
    }
    if (c.from.ref === c.to.ref && c.from.pin.toLowerCase() === c.to.pin.toLowerCase()) {
      issues.add("self_connection", `${c.from.ref}.${c.from.pin} is connected to itself.`, { pins: [c.from] });
    }
  }

  // ---- refusals (never repaired) --------------------------------------------------
  for (const p of parts.values()) {
    const hz = p.profile.hazards;
    if (hz.includes("mains")) {
      issues.add("refuse_mains", `${partLabel(p)} involves mains (wall) voltage. PartsPilot does not plan mains-powered builds.`, { parts: [p.ref] });
    }
    if (hz.includes("weapon")) {
      issues.add("refuse_weapon", `${partLabel(p)} is used for weapon-like builds, which PartsPilot does not plan.`, { parts: [p.ref] });
    } else if (hz.includes("high_voltage")) {
      issues.add("refuse_high_voltage", `${partLabel(p)} generates dangerous high voltage.`, { parts: [p.ref] });
    }
  }
  const structural = issues.list.filter((i) => i.severity === "block").length > 0;
  const prelim = buildNetlist(parts, input.connections);
  checkLipoCharging(prelim, issues);
  if (issues.list.some((i) => i.severity === "refuse")) {
    return { passed: false, refused: true, issues: issues.list.filter((i) => i.severity === "refuse") };
  }
  if (structural) return { passed: false, refused: false, issues: issues.list };

  // ---- electrical analysis ------------------------------------------------------------
  const nl = prelim;
  const power = analyzePower(nl, input.power_mode);
  const ctx = new Ctx(nl, power);

  checkShorts(ctx, issues);
  checkVoltages(ctx, issues);
  checkLoads(ctx, issues);
  const ledCurrent = checkLeds(ctx, issues);
  checkPinCurrents(ctx, ledCurrent, issues);
  checkPowerBudget(ctx, issues, input.power_mode);
  checkGround(ctx, issues);
  checkPins(ctx, ledCurrent, issues);

  return { passed: issues.list.length === 0, refused: false, issues: issues.list };
}

// ---------------------------------------------------------------------------------------

class Ctx {
  readonly groups = new Map<Net, Net[]>();
  constructor(
    readonly nl: Netlist,
    readonly power: PowerState,
  ) {
    // Conductive groups: nets joined through resistors/pots/buttons, never through ground.
    const parent = new Map<Net, Net>();
    const find = (n: Net): Net => {
      const p = parent.get(n) ?? n;
      if (p === n) return n;
      const r = find(p);
      parent.set(n, r);
      return r;
    };
    for (const part of nl.parts.values()) {
      if (!isConductivePassive(part)) continue;
      const nets = part.profile.pins
        .map((p) => nl.nodes.get(`${part.ref}.${p.name}`))
        .filter((n): n is Node => Boolean(n))
        .map((n) => nl.netOf.get(n.key)!)
        .filter((net) => !this.isGround(net));
      for (let i = 1; i < nets.length; i++) parent.set(find(nets[i]!), find(nets[0]!));
    }
    const byRoot = new Map<Net, Net[]>();
    for (const net of nl.nets) byRoot.set(find(net), [...(byRoot.get(find(net)) ?? []), net]);
    for (const members of byRoot.values()) for (const m of members) this.groups.set(m, members);
  }

  netOf(n: Node): Net {
    return this.nl.netOf.get(n.key)!;
  }
  isGround(net: Net): boolean {
    return net.nodes.some((n) => n.pin.kind === "ground");
  }
  netV(net: Net): number | undefined {
    return this.power.netVoltage.get(net);
  }
  /** Worst-case level a pin can put on its net. */
  level(n: Node): number | undefined {
    const pin = n.pin;
    switch (pin.kind) {
      case "gpio":
        return pin.logic_v;
      case "output":
      case "analog_out":
      case "bidir":
        return pin.logic_v ?? (pin.out_v_from ? this.power.voltageOf(n.ref, pin.out_v_from) : undefined);
      case "driver_out":
        return pin.out_v_from ? this.power.voltageOf(n.ref, pin.out_v_from) : undefined;
      case "power_out":
        return this.netV(this.netOf(n));
      default:
        return undefined;
    }
  }
  /** Highest level on the node's conductive group, excluding the node itself. */
  maxLevelAround(n: Node): { v: number; from: Node } | null {
    let best: { v: number; from: Node } | null = null;
    for (const net of this.groups.get(this.netOf(n)) ?? [this.netOf(n)]) {
      for (const m of net.nodes) {
        if (m === n) continue;
        const v = this.level(m);
        if (v !== undefined && (!best || v > best.v)) best = { v, from: m };
      }
      // A powered rail (incl. a USB-fed VIN pin of kind power_in) holds its net at the rail voltage.
      const nv = this.netV(net);
      if (nv !== undefined && (!best || nv > best.v)) {
        best = { v: nv, from: net.nodes.find((m) => m !== n && (m.pin.kind === "power_out" || m.pin.kind === "power_in")) ?? net.nodes[0]! };
      }
    }
    return best;
  }
  connected(part: PlacedPart): boolean {
    return this.nl.connectedRefs.has(part.ref);
  }
  nodesOf(part: PlacedPart): Node[] {
    return part.profile.pins.map((p) => this.nl.nodes.get(`${part.ref}.${p.name}`)).filter((n): n is Node => Boolean(n));
  }
}

function checkLipoCharging(nl: Netlist, issues: Issues): void {
  for (const charger of nl.parts.values()) {
    const ch = charger.profile.charger;
    if (!ch || ch.protection) continue;
    for (const node of charger.profile.pins.filter((p) => p.kind === "power_in")) {
      const n = nl.nodes.get(`${charger.ref}.${node.name}`);
      if (!n) continue;
      for (const peer of nl.netOf.get(n.key)!.nodes) {
        const bat = peer.part.profile.battery;
        if (bat && (bat.chemistry === "lipo" || bat.chemistry === "li_ion") && !bat.protected) {
          issues.add(
            "refuse_lipo_unprotected",
            `${partLabel(charger)} has no protection circuit and is charging the unprotected cell ${partLabel(peer.part)}. Charging lithium cells without protection can cause fire.`,
            { parts: [charger.ref, peer.ref] },
          );
        }
      }
    }
  }
}

function checkShorts(ctx: Ctx, issues: Issues): void {
  for (const net of ctx.nl.nets) {
    const ground = net.nodes.find((n) => n.pin.kind === "ground");
    const supply = net.nodes.find((n) => n.pin.kind === "power_out");
    if (ground && supply) {
      issues.add("short_circuit", `${pinLabel(supply)} (power) is wired straight to ${pinLabel(ground)} (ground) — a short circuit.`, {
        pins: [ref(supply), ref(ground)],
        hint: "Never connect a supply pin directly to GND.",
      });
    }
    const rail = ground ?? supply;
    if (rail) {
      for (const n of net.nodes) {
        if (n.pin.kind === "gpio" || n.pin.kind === "output" || n.pin.kind === "analog_out") {
          issues.add("short_circuit", `${pinLabel(n)} is wired directly to ${pinLabel(rail)}; a driven pin on a supply/ground rail is a short.`, {
            pins: [ref(n), ref(rail)],
            hint: "Connect signal pins to signal pins only; use a resistor for pull-ups/pull-downs.",
          });
        }
      }
    }
  }
  for (const { sources } of ctx.power.shortedNets) {
    issues.add(
      "power_sources_shorted",
      `Two power sources feed the same rail: ${sources.map((s) => s.key).join(" and ")}. They will fight each other.`,
      { hint: "Use one source per rail; e.g. power the controller from the battery via VIN, not from another regulator's output." },
    );
  }
}

function checkVoltages(ctx: Ctx, issues: Issues): void {
  for (const n of ctx.nl.nodes.values()) {
    const pin = n.pin;
    if ((pin.kind === "gpio" || pin.kind === "input" || pin.kind === "bidir") && pin.max_in_v !== undefined) {
      const worst = ctx.maxLevelAround(n);
      if (worst && worst.v > pin.max_in_v + EPS) {
        issues.add(
          "voltage_mismatch",
          `${pinLabel(n)} (${n.part.part.name}) tolerates at most ${fmtV(pin.max_in_v)} but ${pinLabel(worst.from)} drives it at ${fmtV(worst.v)}.`,
          {
            parts: [n.ref, worst.from.ref],
            pins: [ref(n), ref(worst.from)],
            hint: `Insert a level shifter (logic-level-shifter-4ch) or, for a one-way ${fmtV(worst.v)}→3.3 V signal, the voltage-divider-5v-3v3 between ${pinLabel(worst.from)} and ${pinLabel(n)}; or power the module from 3.3 V if it supports it.`,
          },
        );
      }
    }
    if (pin.kind === "power_in" && pin.range_v) {
      const net = ctx.netOf(n);
      const v = ctx.netV(net) ?? ctx.maxLevelAround(n)?.v;
      if (v === undefined) continue;
      const [lo, hi] = pin.range_v;
      if (v > hi + EPS || v < lo - EPS) {
        issues.add(
          "supply_voltage_out_of_range",
          `${pinLabel(n)} (${n.part.part.name}) needs ${fmtV(lo)}–${fmtV(hi)} but gets ${fmtV(v)}.`,
          {
            parts: [n.ref],
            pins: [ref(n)],
            hint: v > hi ? "Feed it from a lower rail or add a regulator (lm2596-buck-converter / ams1117-3v3-module)." : "Feed it from a higher rail (e.g. 5 V or the battery) or choose a source in range.",
          },
        );
      }
    }
  }
}

function checkLoads(ctx: Ctx, issues: Issues): void {
  for (const part of ctx.nl.parts.values()) {
    if (!part.profile.load || !ctx.connected(part)) continue;
    for (const t of ctx.nodesOf(part).filter((n) => n.pin.kind === "load")) {
      for (const peer of ctx.netOf(t).nodes) {
        if (peer.ref === part.ref) continue;
        if (LOGIC_KINDS.has(peer.pin.kind)) {
          issues.add(
            "driver_required",
            `${partLabel(part)} is a ${part.profile.load.kind.replace("_", " ")} (~${part.profile.load.current_ma} mA) wired directly to ${pinLabel(peer)}. A controller pin cannot drive it.`,
            {
              parts: [part.ref, peer.ref],
              pins: [ref(t), ref(peer)],
              hint: "Drive it through a driver: l298n-motor-driver / tb6612fng-motor-driver for motors, irlz44n-mosfet + diode-1n4007, or relay-module-5v-1ch. Connect the controller pin to the driver's input.",
            },
          );
        }
      }
    }
  }
}

/** Returns the LED current attributed to each controller pin key. */
function checkLeds(ctx: Ctx, issues: Issues): Map<string, number> {
  const perPin = new Map<string, number>();
  const directSource = (net: Net) => {
    let best: Node | null = null;
    for (const n of net.nodes) {
      const v = ctx.level(n);
      if (v !== undefined && (!best || v > ctx.level(best)!)) best = n;
    }
    return best;
  };
  const sinks = (net: Net) => net.nodes.some((n) => n.pin.kind === "ground" || n.pin.kind === "gpio");
  const resistors = (net: Net) =>
    net.nodes
      .filter((n) => n.part.profile.resistance_ohm !== undefined)
      .flatMap((n) => {
        const other = ctx.nodesOf(n.part).find((m) => m !== n);
        return other ? [{ part: n.part, ohm: n.part.profile.resistance_ohm!, other: ctx.netOf(other) }] : [];
      });

  for (const part of ctx.nl.parts.values()) {
    const led = part.profile.led;
    if (!led || !ctx.connected(part)) continue;
    const a = ctx.nodesOf(part).find((n) => n.pin.name === "A");
    const k = ctx.nodesOf(part).find((n) => n.pin.name === "C");
    if (!a || !k) continue;
    const A = ctx.netOf(a);
    const K = ctx.netOf(k);
    let current: number | null = null;
    let src: Node | null = null;
    const srcA = directSource(A);
    if (srcA && sinks(K)) {
      issues.add("led_needs_resistor", `${partLabel(part)} is connected to ${pinLabel(srcA)} without a series resistor; it will burn out and can damage the pin.`, {
        parts: [part.ref],
        pins: [ref(srcA), ref(a)],
        hint: `Put a resistor (220–330 Ω, e.g. resistor-220) between ${pinLabel(srcA)} and ${part.ref}.A.`,
      });
      continue;
    }
    for (const r of resistors(A)) {
      const s = directSource(r.other);
      if (s && sinks(K)) {
        current = ((ctx.level(s)! - led.vf) / r.ohm) * 1000;
        src = s;
      }
    }
    if (current === null && srcA) {
      for (const r of resistors(K)) {
        if (sinks(r.other)) {
          current = ((ctx.level(srcA)! - led.vf) / r.ohm) * 1000;
          src = srcA;
        }
      }
    }
    if (current === null || !src) continue;
    if (src.pin.kind === "gpio") perPin.set(src.key, (perPin.get(src.key) ?? 0) + Math.max(current, 0));
    if (current > led.max_ma + 0.5) {
      issues.add("pin_current_exceeded", `${partLabel(part)} would draw ${current.toFixed(0)} mA (max ${led.max_ma} mA); the series resistor is too small.`, {
        parts: [part.ref],
        hint: `Use a resistor of at least ${Math.ceil((((ctx.level(src) ?? 5) - led.vf) / led.max_ma) * 1000)} Ω.`,
      });
    }
  }
  return perPin;
}

function checkPinCurrents(ctx: Ctx, ledCurrent: Map<string, number>, issues: Issues): void {
  const perMcu = new Map<string, number>();
  for (const n of ctx.nl.nodes.values()) {
    if (n.pin.kind !== "gpio") continue;
    let total = ledCurrent.get(n.key) ?? 0;
    for (const peer of ctx.netOf(n).nodes) {
      if (peer.ref === n.ref) continue;
      if (peer.pin.kind === "input" || peer.pin.kind === "power_in") total += peer.pin.draw_ma ?? 0;
    }
    perMcu.set(n.ref, (perMcu.get(n.ref) ?? 0) + total);
    const max = n.pin.max_ma ?? Infinity;
    if (total > max + 0.5) {
      issues.add("pin_current_exceeded", `${pinLabel(n)} would supply ~${total.toFixed(0)} mA but is rated for ${max} mA.`, {
        pins: [ref(n)],
        hint: "Switch the load with a transistor/MOSFET or relay module, or power it from a supply rail instead of a pin.",
      });
    }
  }
  for (const [mcuRef, total] of perMcu) {
    const part = ctx.nl.parts.get(mcuRef)!;
    const max = part.profile.gpio_total_ma;
    if (max && total > max) {
      issues.add("mcu_current_exceeded", `${partLabel(part)} pins would supply ~${total.toFixed(0)} mA in total (limit ${max} mA).`, {
        parts: [mcuRef],
        hint: "Move loads onto drivers or supply rails.",
      });
    }
  }
  for (const [key, ma] of ctx.power.loadsOnDriverOut) {
    const node = ctx.nl.nodes.get(key)!;
    const max = node.pin.max_ma ?? Infinity;
    if (ma > max) {
      issues.add("pin_current_exceeded", `${pinLabel(node)} (${node.part.part.name}) would carry ${ma} mA (rated ${max} mA).`, {
        pins: [ref(node)],
        hint: "Use a stronger driver or split the loads across outputs.",
      });
    }
  }
}

function checkPowerBudget(ctx: Ctx, issues: Issues, mode: PowerMode): void {
  const consumers = [...ctx.nl.parts.values()].filter(
    (p) => (ctx.connected(p) || p.profile.role === "mcu") && (p.profile.role === "mcu" || p.profile.pins.some((x) => x.kind === "power_in")),
  );
  if (ctx.power.sources.length === 0 && consumers.length > 0) {
    issues.add("no_power_source", "Nothing powers this circuit.", {
      hint: mode === "usb" ? "Include a controller board powered over USB." : "Add a battery or DC adapter and wire it to the controller (VIN) and drivers.",
    });
    return;
  }
  const shorted = new Set(ctx.power.shortedNets.flatMap((s) => s.sources.map((x) => x.key)));
  for (const s of ctx.power.sources) {
    if (shorted.has(s.key) || !Number.isFinite(s.capacityMa)) continue;
    const demand = ctx.power.demandOfKey(s.key);
    if (demand > s.capacityMa + 1) {
      const what = s.origin === "usb" ? `USB power through ${s.key}` : s.key;
      issues.add("power_budget_exceeded", `${what} can supply about ${s.capacityMa} mA, but the parts on it draw about ${Math.round(demand)} mA.`, {
        parts: [s.ref],
        hint: "Power motors/servos/LED strips from a separate battery or adapter (e.g. via an lm2596-buck-converter), keep a common ground, or use a bigger supply.",
      });
    }
  }
  for (const part of consumers) {
    const pr = part.profile;
    const powerIns = pr.pins.filter((p) => p.kind === "power_in");
    const powered = (pinName: string) => {
      if (ctx.power.voltageOf(part.ref, pinName) !== undefined) return true;
      const node = ctx.nl.nodes.get(`${part.ref}.${pinName}`);
      return node ? ctx.maxLevelAround(node) !== null : false;
    };
    let ok: boolean;
    if (pr.role === "mcu") ok = (mode === "usb" && Boolean(pr.usb_power)) || powerIns.some((p) => powered(p.name));
    else if (pr.role === "charger") ok = powerIns.some((p) => powered(p.name));
    else ok = powerIns.every((p) => powered(p.name));
    if (!ok) {
      const missing = powerIns.filter((p) => !powered(p.name)).map((p) => `${part.ref}.${p.name}`);
      issues.add("part_unpowered", `${partLabel(part)} has no power on ${missing.join(", ") || "its supply pins"}.`, {
        parts: [part.ref],
        hint: `Connect ${missing.join(", ")} to a supply rail in its voltage range.`,
      });
    }
  }
}

function checkGround(ctx: Ctx, issues: Issues): void {
  const groundNet = new Map<string, Net | null>();
  for (const part of ctx.nl.parts.values()) {
    const gpins = part.profile.pins.filter((p) => p.kind === "ground");
    if (!gpins.length || !ctx.connected(part)) continue;
    const linked = ctx
      .nodesOf(part)
      .filter((n) => n.pin.kind === "ground")
      .map((n) => ctx.netOf(n))
      .find((net) => net.nodes.some((m) => m.ref !== part.ref));
    groundNet.set(part.ref, linked ?? null);
    if (!linked) {
      issues.add("missing_ground", `${partLabel(part)} has no ground connection.`, {
        parts: [part.ref],
        hint: `Connect ${part.ref}.${gpins[0]!.name} to the common GND.`,
      });
    }
  }
  for (const net of ctx.nl.nets) {
    const refs = [...new Set(net.nodes.filter((n) => LOGIC_KINDS.has(n.pin.kind)).map((n) => n.ref))];
    if (refs.length < 2) continue;
    const grounds = refs.map((r) => groundNet.get(r)).filter((g): g is Net => g !== undefined && g !== null);
    if (new Set(grounds).size > 1) {
      issues.add("no_common_ground", `${refs.join(" and ")} exchange signals but do not share a ground.`, {
        parts: refs,
        hint: "Connect the GND of every power domain together (battery −, driver GND, controller GND).",
      });
    }
  }
}

function checkPins(ctx: Ctx, ledCurrent: Map<string, number>, issues: Issues): void {
  for (const n of ctx.nl.nodes.values()) {
    if (n.pin.kind !== "gpio") continue;
    const net = ctx.netOf(n);
    const peers = net.nodes.filter((m) => m.ref !== n.ref);
    const otherGpio = net.nodes.filter((m) => m !== n && m.pin.kind === "gpio");
    if (otherGpio.length && n.key < otherGpio[0]!.key) {
      issues.add("output_conflict", `${pinLabel(n)} and ${pinLabel(otherGpio[0]!)} are wired together.`, {
        pins: [ref(n), ref(otherGpio[0]!)],
        hint: "Each controller pin gets its own net.",
      });
    }
    const functional = peers.filter((m) => LOGIC_KINDS.has(m.pin.kind) || m.pin.kind === "power_in" || m.pin.kind === "load");
    const byPart = new Set(functional.map((m) => m.ref));
    const allBus = functional.length > 0 && functional.every((m) => m.pin.bus && m.pin.bus === functional[0]!.pin.bus);
    if (byPart.size > 1 && !allBus) {
      issues.add("pin_reused", `${pinLabel(n)} is used for ${functional.map(pinLabel).join(" and ")}; one pin can serve only one function.`, {
        pins: [ref(n), ...functional.map(ref)],
        hint: "Move one of these connections to a free controller pin.",
      });
    }
    const drivers = peers.filter((m) => m.pin.kind === "output" || m.pin.kind === "analog_out");
    if (drivers.length > 1) {
      issues.add("output_conflict", `${drivers.map(pinLabel).join(" and ")} both drive ${pinLabel(n)}.`, { pins: drivers.map(ref) });
    }

    const drivesOut =
      (ledCurrent.get(n.key) ?? 0) > 0 || peers.some((m) => m.pin.kind === "input" || m.pin.kind === "power_in" || m.pin.kind === "load");
    const drivesLed = (ledCurrent.get(n.key) ?? 0) > 0;
    const readsIn =
      peers.some((m) => m.pin.kind === "output" || m.pin.kind === "analog_out") || (!drivesLed && peers.some((m) => m.pin.kind === "passive"));
    const bidi = peers.some((m) => m.pin.kind === "bidir");
    const modes: ("input" | "output")[] = [];
    if (drivesOut || bidi) modes.push("output");
    if (readsIn || bidi) modes.push("input");
    if (n.pin.input_only && modes.includes("output")) {
      issues.add("input_only_as_output", `${pinLabel(n)} is input-only but is used to drive ${peers.map(pinLabel).join(", ")}.`, {
        pins: [ref(n)],
        hint: "Use an output-capable GPIO for this signal.",
      });
    }
    const res = n.pin.reserved;
    if (res && modes.some((m) => res.blocked.includes(m))) {
      issues.add("reserved_pin", `${pinLabel(n)} should not be used here: ${res.note}`, { pins: [ref(n)], hint: "Pick another free GPIO." });
    }
    for (const m of peers) {
      const needs = [...m.pin.requires];
      if (m.pin.bus === "i2c" && /sda/i.test(m.pin.name)) needs.push("i2c_sda");
      if (m.pin.bus === "i2c" && /scl/i.test(m.pin.name)) needs.push("i2c_scl");
      const missing = needs.filter((c) => !n.pin.caps.includes(c));
      if (missing.length) {
        const better = [...n.part.profile.pins].filter((p) => p.kind === "gpio" && missing.every((c) => p.caps.includes(c))).map((p) => p.name);
        issues.add("pin_capability", `${pinLabel(m)} needs a ${missing.join("/")} pin but ${pinLabel(n)} does not support it.`, {
          pins: [ref(m), ref(n)],
          hint: `Use one of: ${better.slice(0, 12).join(", ") || "no pin on this board"}.`,
        });
      }
    }
  }
}
