import type { CatalogPart, Connection, PartProfile, PinSpec } from "@partspilot/shared";

export interface PlanPart {
  ref: string;
  part_id: string;
  qty?: number;
}

export interface PlacedPart {
  ref: string;
  part: CatalogPart;
  profile: PartProfile;
  /** lower-cased name/alias → pin */
  pinIndex: Map<string, PinSpec>;
}

export interface Node {
  key: string; // `${ref}.${canonical pin}`
  ref: string;
  part: PlacedPart;
  pin: PinSpec;
}

export interface Net {
  id: number;
  nodes: Node[];
}

export interface Netlist {
  parts: Map<string, PlacedPart>;
  nodes: Map<string, Node>;
  nets: Net[];
  netOf: Map<string, Net>;
  /** refs that appear in at least one connection */
  connectedRefs: Set<string>;
}

export function indexPins(profile: PartProfile): Map<string, PinSpec> {
  const m = new Map<string, PinSpec>();
  for (const pin of profile.pins) {
    for (const n of [pin.name, ...pin.aliases]) if (!m.has(n.toLowerCase())) m.set(n.toLowerCase(), pin);
  }
  return m;
}

class Dsu {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Builds nets from resolved parts and connections. Unresolvable endpoints are skipped (reported elsewhere). */
export function buildNetlist(parts: Map<string, PlacedPart>, connections: Connection[]): Netlist {
  const nodes = new Map<string, Node>();
  const dsu = new Dsu();
  const connectedRefs = new Set<string>();

  const nodeFor = (ref: string, pinName: string): Node | null => {
    const part = parts.get(ref);
    const pin = part?.pinIndex.get(pinName.toLowerCase());
    if (!part || !pin) return null;
    const key = `${ref}.${pin.name}`;
    let node = nodes.get(key);
    if (!node) {
      node = { key, ref, part, pin };
      nodes.set(key, node);
    }
    return node;
  };

  for (const c of connections) {
    const a = nodeFor(c.from.ref, c.from.pin);
    const b = nodeFor(c.to.ref, c.to.pin);
    if (!a || !b) continue;
    connectedRefs.add(a.ref);
    connectedRefs.add(b.ref);
    dsu.union(a.key, b.key);
  }

  // Internal bridges (e.g. the three GND pins of an Uno) join nets inside a part.
  for (const part of parts.values()) {
    if (!connectedRefs.has(part.ref)) continue;
    for (const group of part.profile.bridges) {
      const members = group.map((n) => nodeFor(part.ref, n)).filter((n): n is Node => n !== null);
      for (let i = 1; i < members.length; i++) dsu.union(members[0]!.key, members[i]!.key);
    }
  }

  const byRoot = new Map<string, Node[]>();
  for (const node of nodes.values()) {
    const root = dsu.find(node.key);
    byRoot.set(root, [...(byRoot.get(root) ?? []), node]);
  }
  const nets: Net[] = [...byRoot.values()].map((ns, id) => ({ id, nodes: ns }));
  const netOf = new Map<string, Net>();
  for (const net of nets) for (const n of net.nodes) netOf.set(n.key, net);
  return { parts, nodes, nets, netOf, connectedRefs };
}

/**
 * Parts that conduct DC between their pins (resistors, pots, buttons, LDRs, keypads, diodes).
 * Used to propagate a worst-case voltage: a series resistor does not make 5 V safe for a 3.3 V pin.
 */
export function isConductivePassive(p: PlacedPart): boolean {
  const pins = p.profile.pins;
  if (pins.length < 2 || p.profile.led) return false;
  if (/capacitor/i.test(p.part.name)) return false;
  return pins.every((x) => x.kind === "passive");
}

export const pinLabel = (n: Node) => `${n.ref}.${n.pin.name}`;
export const partLabel = (p: PlacedPart) => `${p.ref} (${p.part.name})`;
