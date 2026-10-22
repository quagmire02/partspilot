import type { CatalogPart, Connection, NetKind, PowerMode } from "@partspilot/shared";
import { buildNetlist, indexPins, type PlacedPart } from "./netlist";
import { analyzePower } from "./power";

export { validatePlan, type CatalogLookup, type ValidateInput } from "./validate";
export { buildNetlist, indexPins, type Netlist, type Net, type Node, type PlacedPart } from "./netlist";

export interface ClassifiedNet {
  id: string;
  kind: NetKind;
  /** e.g. "GND", "5V", "3.3V", "7.4V", "N3" */
  name: string;
  voltage: number | null;
  pins: { ref: string; pin: string }[];
}

/** Net names/kinds for the diagram: ground, powered rails, load wiring, signals. */
export function classifyNets(
  input: { parts: { ref: string; part_id: string }[]; connections: Connection[]; power_mode: PowerMode },
  catalog: (id: string) => CatalogPart | undefined,
): ClassifiedNet[] {
  const parts = new Map<string, PlacedPart>();
  for (const p of input.parts) {
    const cat = catalog(p.part_id);
    if (cat?.profile) parts.set(p.ref, { ref: p.ref, part: cat, profile: cat.profile, pinIndex: indexPins(cat.profile) });
  }
  const nl = buildNetlist(parts, input.connections);
  const power = analyzePower(nl, input.power_mode);
  let signal = 0;
  return nl.nets.map((net, i) => {
    const v = power.netVoltage.get(net) ?? null;
    const kind: NetKind = net.nodes.some((n) => n.pin.kind === "ground")
      ? "ground"
      : v !== null || net.nodes.some((n) => n.pin.kind === "power_out" || n.pin.kind === "power_in")
        ? "power"
        : net.nodes.some((n) => n.pin.kind === "load" || n.pin.kind === "driver_out" || n.pin.kind === "contact")
          ? "load"
          : "signal";
    const name = kind === "ground" ? "GND" : kind === "power" && v !== null ? `${Number(v.toFixed(1))}V` : `N${++signal}`;
    return { id: `net${i}`, kind, name, voltage: v, pins: net.nodes.map((n) => ({ ref: n.ref, pin: n.pin.name })) };
  });
}
