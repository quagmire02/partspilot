import {
  buyLinks,
  type BomLine,
  type CatalogPart,
  type DiagramSpec,
  type MissingPart,
  type PlannerOutput,
  type PlanResult,
  type ValidationReport,
  type Verdict,
} from "@partspilot/shared";

/** Consumables everyone has on the bench; never reported as missing. */
export const ASSUMED_AVAILABLE = new Set(["jumper-wires-male-male", "jumper-wires-male-female", "usb-cable-a-b", "breadboard-830"]);

export interface InventoryLine {
  part_id: string;
  quantity: number;
}

/** Need per part id, with composite kits (e.g. a resistor divider) expanded into their parts. */
function needs(plan: PlannerOutput, lookup: (id: string) => CatalogPart | undefined, have: Map<string, number>): Map<string, number> {
  const need = new Map<string, number>();
  const add = (id: string, qty: number) => need.set(id, (need.get(id) ?? 0) + qty);
  for (const p of plan.parts) {
    const kit = lookup(p.part_id)?.profile?.kit ?? [];
    if (kit.length && (have.get(p.part_id) ?? 0) < p.qty) for (const k of kit) add(k.part_id, k.qty * p.qty);
    else add(p.part_id, p.qty);
  }
  return need;
}

export function computeBom(
  plan: PlannerOutput,
  inventory: InventoryLine[],
  lookup: (id: string) => CatalogPart | undefined,
): { bom: BomLine[]; missing: MissingPart[] } {
  const have = new Map<string, number>();
  for (const i of inventory) have.set(i.part_id, (have.get(i.part_id) ?? 0) + i.quantity);

  const missing: MissingPart[] = [];
  for (const [id, qty] of needs(plan, lookup, have)) {
    const short = qty - (have.get(id) ?? 0);
    if (short <= 0 || ASSUMED_AVAILABLE.has(id)) continue;
    const part = lookup(id);
    missing.push({ part_id: id, name: part?.name ?? id, qty: short, buy_links: buyLinks(part?.buy_query ?? part?.name ?? id) });
  }

  missing.sort((a, b) => a.name.localeCompare(b.name));

  const left = new Map(have);
  const bom: BomLine[] = plan.parts.map((p) => {
    const kit = lookup(p.part_id)?.profile?.kit ?? [];
    const owned = left.get(p.part_id) ?? 0;
    let isHave = owned >= p.qty || ASSUMED_AVAILABLE.has(p.part_id);
    if (owned >= p.qty) left.set(p.part_id, owned - p.qty);
    else if (kit.length) isHave = kit.every((k) => (left.get(k.part_id) ?? 0) >= k.qty * p.qty);
    return { ref: p.ref, part_id: p.part_id, name: lookup(p.part_id)?.name ?? p.part_id, qty: p.qty, purpose: p.purpose, have: isHave };
  });
  return { bom, missing };
}

export function verdictFor(plan: PlannerOutput, missing: MissingPart[]): Verdict {
  if (plan.feasibility === "closest_alternative") return "no_closest";
  return missing.length ? "yes_missing" : "yes";
}

export function toPlanResult(a: {
  id: string;
  plan: PlannerOutput;
  validation: ValidationReport;
  attempts: number;
  inventory: InventoryLine[];
  lookup: (id: string) => CatalogPart | undefined;
  diagram: DiagramSpec | null;
}): PlanResult {
  const { plan, validation } = a;
  if (validation.refused) return refusalResult(a.id, validation, a.attempts);
  const { bom, missing } = computeBom(plan, a.inventory, a.lookup);
  return {
    id: a.id,
    title: plan.title,
    summary: plan.summary,
    verdict: verdictFor(plan, missing),
    closest_reason: plan.feasibility === "closest_alternative" ? plan.closest_reason : null,
    language: plan.language,
    power_mode: plan.power_mode,
    bom,
    missing,
    connections: plan.connections,
    steps: plan.steps,
    code: { language: plan.language, filename: plan.code.filename, source: plan.code.source },
    libraries: plan.libraries.map((l) => ({ name: l.name, install_hint: l.install_hint })),
    safety_notes: plan.safety_notes,
    validation: { passed: validation.passed, attempts: a.attempts, issues: validation.issues },
    diagram: validation.passed ? a.diagram : null,
    reference_project_id: plan.reference_project_id,
  };
}

export function refusalResult(id: string, validation: ValidationReport, attempts: number, title = "We can't help with this build"): PlanResult {
  return {
    id,
    title,
    summary: "This build involves hazards PartsPilot does not plan for.",
    verdict: "refused",
    closest_reason: null,
    language: null,
    power_mode: null,
    bom: [],
    missing: [],
    connections: [],
    steps: [],
    code: null,
    libraries: [],
    safety_notes: validation.issues.map((i) => i.message),
    validation: { passed: false, attempts, issues: validation.issues },
    diagram: null,
    reference_project_id: null,
  };
}
