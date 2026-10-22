import type { DiagramSpec, DiagramWire } from "@partspilot/shared";

export interface Size {
  w: number;
  h: number;
}
export interface Box extends Size {
  x: number;
  y: number;
}
export type Point = { x: number; y: number };

const GAP_X = 140;
const GAP_Y = 36;

/**
 * Deterministic schematic layout: the most-connected part (the controller) in the middle,
 * parts it talks to alternate left/right, power sources along the bottom.
 */
export function layoutNodes(spec: DiagramSpec, sizes: Map<string, Size>): Map<string, Box> {
  const degree = new Map<string, number>();
  for (const w of spec.wires) for (const r of [w.from.ref, w.to.ref]) degree.set(r, (degree.get(r) ?? 0) + 1);
  const refs = spec.nodes.map((n) => n.ref);
  const center = [...refs].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))[0];
  if (!center) return new Map();

  const isPowerish = (ref: string) => {
    const ws = spec.wires.filter((w) => w.from.ref === ref || w.to.ref === ref);
    return ws.length > 0 && ws.every((w) => w.kind === "power" || w.kind === "ground");
  };
  const links = (a: string, b: string) => spec.wires.filter((w) => (w.from.ref === a && w.to.ref === b) || (w.to.ref === a && w.from.ref === b)).length;
  const others = refs.filter((r) => r !== center);
  const bottom = others.filter(isPowerish);
  const sides = others.filter((r) => !bottom.includes(r));
  // Parts wired to the controller alternate right/left; "satellites" (e.g. motors on a
  // driver) go into the same column as, and right after, the part they connect to.
  const direct = sides.filter((r) => links(r, center) > 0).sort((a, b) => links(b, center) - links(a, center) || a.localeCompare(b));
  const left: string[] = [];
  const right: string[] = [];
  direct.forEach((r, i) => (i % 2 === 0 ? right : left).push(r));
  const satellites = sides.filter((r) => !direct.includes(r)).sort((a, b) => a.localeCompare(b));
  const anchorOf = new Map<string, string>();
  for (const s of satellites) {
    const anchor = direct.filter((r) => links(s, r) > 0).sort((a, b) => links(s, b) - links(s, a) || a.localeCompare(b))[0];
    if (!anchor) {
      (left.length <= right.length ? left : right).push(s);
      continue;
    }
    const col = left.includes(anchor) ? left : right;
    let at = col.indexOf(anchor);
    while (at + 1 < col.length && anchorOf.get(col[at + 1]!) === anchor) at++;
    col.splice(at + 1, 0, s);
    anchorOf.set(s, anchor);
  }

  const size = (r: string) => sizes.get(r) ?? { w: 160, h: 100 };
  const colWidth = (col: string[]) => Math.max(0, ...col.map((r) => size(r).w));
  const colHeight = (col: string[]) => col.reduce((s, r) => s + size(r).h, 0) + Math.max(0, col.length - 1) * GAP_Y;

  const c = size(center);
  const leftW = colWidth(left);
  const cx = leftW ? leftW + GAP_X : 0;
  const top = 0;
  const height = Math.max(c.h, colHeight(left), colHeight(right));
  const boxes = new Map<string, Box>();
  boxes.set(center, { x: cx, y: top + (height - c.h) / 2, ...c });

  const stack = (col: string[], x: (r: string) => number) => {
    let y = top + (height - colHeight(col)) / 2;
    for (const r of col) {
      boxes.set(r, { x: x(r), y, ...size(r) });
      y += size(r).h + GAP_Y;
    }
  };
  stack(left, (r) => leftW - size(r).w);
  stack(right, () => cx + c.w + GAP_X);

  let bx = 0;
  const by = top + height + GAP_Y * 2;
  for (const r of bottom) {
    boxes.set(r, { x: bx, y: by, ...size(r) });
    bx += size(r).w + GAP_X / 2;
  }
  return boxes;
}

/** Orthogonal route: out of the source pin, along a per-wire lane, into the target pin. */
export function routeWire(a: Point, b: Point, lane: number, aBox: Box, bBox: Box): string {
  const aSide = a.x < aBox.x + aBox.w / 2 ? -1 : 1;
  const bSide = b.x < bBox.x + bBox.w / 2 ? -1 : 1;
  const offset = 18 + (lane % 8) * 7;
  const ax = a.x + aSide * offset;
  const bx = b.x + bSide * offset;
  const midX = aSide === bSide ? (aSide > 0 ? Math.max(ax, bx) : Math.min(ax, bx)) : (ax + bx) / 2;
  return `M${a.x},${a.y} H${ax} H${midX} V${b.y} H${bx} H${b.x}`;
}

export function wireLanes(wires: DiagramWire[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const perNet = new Map<string, number>();
  wires.forEach((w) => {
    if (!perNet.has(w.net)) perNet.set(w.net, perNet.size);
    lanes.set(w.id, perNet.get(w.net)!);
  });
  return lanes;
}
