import type { CatalogPart, DiagramNode, DiagramSpec, DiagramWire, PlannerOutput } from "@partspilot/shared";
import { classifyNets, indexPins } from "@partspilot/rules";

const SIGNAL_COLORS = ["#2563eb", "#16a34a", "#9333ea", "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#65a30d", "#0d9488", "#c2410c"];

function powerColor(v: number | null): string {
  if (v === null) return "#dc2626";
  if (v > 5.5) return "#991b1b"; // battery / adapter rail
  if (v > 4) return "#ef4444"; // 5 V
  return "#f97316"; // 3.3 V
}

/** Deterministic diagram from validated connections; the desktop lays it out. */
export function buildDiagram(plan: PlannerOutput, lookup: (id: string) => CatalogPart | undefined): DiagramSpec {
  const nets = classifyNets(plan, lookup);
  const netOfPin = new Map<string, (typeof nets)[number]>();
  for (const n of nets) for (const p of n.pins) netOfPin.set(`${p.ref}.${p.pin}`, n);

  const used = new Set(plan.connections.flatMap((c) => [c.from.ref, c.to.ref]));
  const nodes: DiagramNode[] = [];
  const canon = new Map<string, Map<string, string>>();
  for (const p of plan.parts) {
    const part = lookup(p.part_id);
    if (!part?.profile || !used.has(p.ref)) continue;
    const pr = part.profile;
    const idx = indexPins(pr);
    canon.set(p.ref, new Map([...idx.entries()].map(([k, v]) => [k, v.name])));
    nodes.push({
      ref: p.ref,
      part_id: p.part_id,
      label: `${p.ref} · ${part.name}`,
      element: pr.wokwi?.element ?? "pp-generic",
      attrs: pr.wokwi?.attrs ?? {},
      pins: pr.pins
        .filter((x) => x.kind !== "nc")
        .map((x) => ({ name: x.name, element_pin: pr.wokwi ? (pr.wokwi.pin_map[x.name] ?? x.name) : x.name })),
    });
  }

  const signalColor = new Map<string, string>();
  const wires: DiagramWire[] = [];
  plan.connections.forEach((c, i) => {
    const fromPin = canon.get(c.from.ref)?.get(c.from.pin.toLowerCase());
    const toPin = canon.get(c.to.ref)?.get(c.to.pin.toLowerCase());
    if (!fromPin || !toPin) return;
    const net = netOfPin.get(`${c.from.ref}.${fromPin}`);
    const kind = net?.kind ?? "signal";
    let color: string;
    if (kind === "ground") color = "#111827";
    else if (kind === "power") color = powerColor(net?.voltage ?? null);
    else if (kind === "load") color = "#7c3aed";
    else {
      const key = net?.id ?? `w${i}`;
      if (!signalColor.has(key)) signalColor.set(key, SIGNAL_COLORS[signalColor.size % SIGNAL_COLORS.length]!);
      color = signalColor.get(key)!;
    }
    wires.push({
      id: `w${i}`,
      from: { ref: c.from.ref, pin: fromPin },
      to: { ref: c.to.ref, pin: toPin },
      net: net?.name ?? `N${i}`,
      kind,
      color,
    });
  });
  return { version: 1, nodes, wires };
}
