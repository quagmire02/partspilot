import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiagramNode, DiagramSpec } from "@partspilot/shared";
import { layoutNodes, routeWire, wireLanes, type Box, type Point, type Size } from "./layout";

// Registers <wokwi-*> custom elements (MIT). Loaded lazily with the result view.
import "@wokwi/elements";

type PinInfo = { name: string; x: number; y: number };
type WokwiEl = HTMLElement & { pinInfo?: PinInfo[] };
type Sides = { left: string[]; right: string[] };

/** Room around the parts for wire lanes (routes leave pins sideways by up to ~70px). */
const MARGIN = 100;
const PIN_GAP = 18;
const HEAD = 44;
const GENERIC_WIDTH = 170;

function usedPins(spec: DiagramSpec, node: DiagramNode): string[] {
  const used = new Set(spec.wires.flatMap((w) => [w.from, w.to]).filter((e) => e.ref === node.ref).map((e) => e.pin));
  return node.pins.map((p) => p.name).filter((p) => used.has(p));
}

/** Generic boxes show only wired pins, each on the side facing what it connects to. */
function genericSides(spec: DiagramSpec, boxes: Map<string, Box> | null): Map<string, Sides> {
  const out = new Map<string, Sides>();
  for (const node of spec.nodes) {
    if (node.element !== "pp-generic") continue;
    const pins = usedPins(spec, node);
    const me = boxes?.get(node.ref);
    if (!me || !boxes) {
      const half = Math.ceil(pins.length / 2);
      out.set(node.ref, { left: pins.slice(0, half), right: pins.slice(half) });
      continue;
    }
    const cx = me.x + me.w / 2;
    const sides: Sides = { left: [], right: [] };
    for (const pin of pins) {
      const peers = spec.wires
        .filter((w) => (w.from.ref === node.ref && w.from.pin === pin) || (w.to.ref === node.ref && w.to.pin === pin))
        .map((w) => (w.from.ref === node.ref && w.from.pin === pin ? w.to.ref : w.from.ref))
        .map((r) => boxes.get(r))
        .filter((b): b is Box => Boolean(b));
      const px = peers.length ? peers.reduce((s, b) => s + b.x + b.w / 2, 0) / peers.length : cx;
      (px < cx ? sides.left : sides.right).push(pin);
    }
    out.set(node.ref, sides);
  }
  return out;
}

const genericSize = (s: Sides): Size => ({ w: GENERIC_WIDTH, h: HEAD + Math.max(s.left.length, s.right.length, 1) * PIN_GAP });

function genericPinPoint(s: Sides, pin: string): Point | null {
  const li = s.left.indexOf(pin);
  if (li >= 0) return { x: 0, y: HEAD + li * PIN_GAP - PIN_GAP / 2 };
  const ri = s.right.indexOf(pin);
  if (ri >= 0) return { x: GENERIC_WIDTH, y: HEAD + ri * PIN_GAP - PIN_GAP / 2 };
  return null;
}

function GenericPart({ node, sides }: { node: DiagramNode; sides: Sides }) {
  const size = genericSize(sides);
  return (
    <div className="generic-part" style={{ width: size.w, height: size.h }}>
      <div className="generic-title">{node.label}</div>
      {sides.left.map((p, i) => (
        <span key={p} className="generic-pin left" style={{ top: HEAD + i * PIN_GAP - PIN_GAP }}>
          {p}
        </span>
      ))}
      {sides.right.map((p, i) => (
        <span key={p} className="generic-pin right" style={{ top: HEAD + i * PIN_GAP - PIN_GAP }}>
          {p}
        </span>
      ))}
    </div>
  );
}

/** Renders a wokwi element and reports its natural size and pin positions. */
function WokwiPart({ node, onMeasure }: { node: DiagramNode; onMeasure: (ref: string, size: Size, pins: PinInfo[]) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = holder.current;
    if (!host) return;
    host.innerHTML = "";
    const el = document.createElement(node.element) as WokwiEl;
    for (const [k, v] of Object.entries(node.attrs)) el.setAttribute(k, v);
    host.appendChild(el);
    let cancelled = false;
    void customElements.whenDefined(node.element).then(async () => {
      await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
      if (cancelled) return;
      const r = el.getBoundingClientRect();
      onMeasure(node.ref, { w: r.width, h: r.height }, el.pinInfo ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [node, onMeasure]);
  return <div ref={holder} className="wokwi-part" />;
}

export function WiringDiagram({ spec }: { spec: DiagramSpec }) {
  const [measured, setMeasured] = useState<Map<string, { size: Size; pins: PinInfo[] }>>(new Map());
  const [zoom, setZoom] = useState(1);
  const frame = useRef<HTMLDivElement>(null);

  const onMeasure = useMemo(() => (ref: string, size: Size, pins: PinInfo[]) => setMeasured((m) => new Map(m).set(ref, { size, pins })), []);

  // Two passes: provisional pin sides → layout → sides facing real neighbours → final layout.
  const { boxes, sides } = useMemo(() => {
    const sizesFor = (s: Map<string, Sides>) =>
      new Map(spec.nodes.map((n) => [n.ref, n.element === "pp-generic" ? genericSize(s.get(n.ref)!) : (measured.get(n.ref)?.size ?? { w: 160, h: 100 })]));
    const first = genericSides(spec, null);
    const provisional = layoutNodes(spec, sizesFor(first));
    const final = genericSides(spec, provisional);
    return { boxes: layoutNodes(spec, sizesFor(final)), sides: final };
  }, [spec, measured]);
  const ready = spec.nodes.every((n) => n.element === "pp-generic" || measured.has(n.ref));

  const extent = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const b of boxes.values()) {
      w = Math.max(w, b.x + b.w);
      h = Math.max(h, b.y + b.h);
    }
    return { w: w + 2 * MARGIN, h: h + MARGIN + 40 };
  }, [boxes]);

  useEffect(() => {
    if (!ready || !frame.current) return;
    const fit = Math.min(1, (frame.current.clientWidth - 16) / extent.w);
    setZoom(Number.isFinite(fit) && fit > 0.2 ? fit : 0.5);
  }, [ready, extent.w]);

  const nodeByRef = useMemo(() => new Map(spec.nodes.map((n) => [n.ref, n])), [spec]);
  const at = (b: Box): Box => ({ ...b, x: b.x + MARGIN, y: b.y + 40 });
  const pinPoint = (ref: string, pin: string): Point | null => {
    const node = nodeByRef.get(ref);
    const box = boxes.get(ref);
    if (!node || !box) return null;
    const o = at(box);
    if (node.element === "pp-generic") {
      const p = genericPinPoint(sides.get(ref)!, pin);
      return p && { x: o.x + p.x, y: o.y + p.y };
    }
    const elementPin = node.pins.find((p) => p.name === pin)?.element_pin ?? pin;
    const info = measured.get(ref)?.pins.find((p) => p.name === elementPin);
    return info ? { x: o.x + info.x, y: o.y + info.y } : null;
  };
  const lanes = useMemo(() => wireLanes(spec.wires), [spec]);

  return (
    <div className="diagram" ref={frame}>
      <div className="diagram-tools">
        <button type="button" onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))} aria-label="Zoom out">
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(3, z * 1.2))} aria-label="Zoom in">
          +
        </button>
        <span className="legend">
          <i style={{ background: "#111827" }} /> GND <i style={{ background: "#ef4444" }} /> 5 V <i style={{ background: "#f97316" }} /> 3.3 V{" "}
          <i style={{ background: "#991b1b" }} /> battery <i style={{ background: "#7c3aed" }} /> motor/load <i style={{ background: "#2563eb" }} /> signals
        </span>
      </div>
      <div className="diagram-scroll">
        <div className="diagram-canvas" style={{ width: extent.w * zoom, height: extent.h * zoom }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: extent.w, height: extent.h, position: "relative" }}>
            {spec.nodes.map((n) => {
              const b = boxes.get(n.ref);
              const o = b ? at(b) : { x: MARGIN, y: 40 };
              return (
                <div key={n.ref} className="diagram-node" style={{ left: o.x, top: o.y, visibility: ready ? "visible" : "hidden" }}>
                  {n.element === "pp-generic" ? <GenericPart node={n} sides={sides.get(n.ref)!} /> : <WokwiPart node={n} onMeasure={onMeasure} />}
                  {n.element !== "pp-generic" && <div className="diagram-label">{n.label}</div>}
                </div>
              );
            })}
            {ready && (
              <svg className="diagram-wires" width={extent.w} height={extent.h} aria-label="Wires">
                {spec.wires.map((w) => {
                  const a = pinPoint(w.from.ref, w.from.pin);
                  const b = pinPoint(w.to.ref, w.to.pin);
                  const ab = boxes.get(w.from.ref);
                  const bb = boxes.get(w.to.ref);
                  if (!a || !b || !ab || !bb) return null;
                  return (
                    <g key={w.id}>
                      <title>{`${w.from.ref}.${w.from.pin} → ${w.to.ref}.${w.to.pin} (${w.net})`}</title>
                      <path d={routeWire(a, b, lanes.get(w.id) ?? 0, at(ab), at(bb))} stroke={w.color} />
                      <circle cx={a.x} cy={a.y} r={3} fill={w.color} />
                      <circle cx={b.x} cy={b.y} r={3} fill={w.color} />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
