import { z } from "zod";
import {
  DiscoveryOutput,
  LIMITS,
  PlannerOutput,
  type CatalogPart,
  type CodeLanguage,
  type Issue,
  type JobResultPayload,
  type JobStage,
  type PlanResult,
  type ValidationReport,
} from "@partspilot/shared";
import { validatePlan } from "@partspilot/rules";
import type { CatalogAccess, ReferenceRow } from "./catalog";
import { describeAllowedParts } from "./context";
import { buildDiagram } from "./diagram";
import { classifyIntent } from "./intent";
import { refusalResult, toPlanResult, type InventoryLine } from "./postprocess";
import { dataBlock, DISCOVERY_SYSTEM, PLAN_SYSTEM, REPAIR_SUFFIX } from "./prompts";
import { ModelError, type ModelProvider } from "./provider";

export interface PlannerDeps {
  provider: ModelProvider;
  catalog: CatalogAccess;
  /** Cached profiled catalog + reference list (the engine caches per isolate). */
  profiled: () => Promise<CatalogPart[]>;
  references: () => Promise<ReferenceRow[]>;
}

export interface PlanRequest {
  goal: string;
  parts: InventoryLine[];
  planVersion: number;
  languageHint?: CodeLanguage | null;
  onStage?: (stage: Extract<JobStage, "planning" | "validating" | "rendering">) => Promise<void>;
}

const PLANNER_SCHEMA = z.toJSONSchema(PlannerOutput, { io: "input" }) as Record<string, unknown>;
const DISCOVERY_SCHEMA = z.toJSONSchema(DiscoveryOutput, { io: "input" }) as Record<string, unknown>;

const STOP = new Set(["can", "could", "build", "make", "the", "and", "with", "for", "how", "what", "that", "this", "want", "have", "using", "use", "from", "into", "some", "please", "would", "like", "need", "made", "out", "my", "me", "an", "a", "i", "to", "do", "of", "it", "is", "on", "in"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w));

/** Keyword fallback when embeddings are unavailable (local dev, embedding outage). */
export function rankReferencesByKeywords(goal: string, refs: ReferenceRow[]): ReferenceRow[] {
  const g = new Set(words(goal));
  return refs
    .map((r) => {
      const hay = words([r.title, ...(r.goal_examples ?? [])].join(" "));
      return { r, s: hay.filter((w) => g.has(w)).length };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id))
    .map((x) => x.r);
}

async function retrieveReferences(deps: PlannerDeps, goal: string, hintId?: string | null): Promise<ReferenceRow[]> {
  const all = await deps.references();
  let ranked: ReferenceRow[] = [];
  if (goal.trim()) {
    try {
      const [e] = await deps.provider.embed([goal], "query");
      if (e) ranked = await deps.catalog.matchReferenceProjects(e, 3);
    } catch {
      ranked = [];
    }
    if (!ranked.length) ranked = rankReferencesByKeywords(goal, all);
  }
  const hint = hintId ? all.find((r) => r.id === hintId) : undefined;
  if (hint) ranked = [hint, ...ranked.filter((r) => r.id !== hint.id)];
  return ranked.slice(0, 2);
}

function planIssues(plan: PlannerOutput, lookup: (id: string) => CatalogPart | undefined): Issue[] {
  const issues: Issue[] = [];
  const mcus = plan.parts.filter((p) => lookup(p.part_id)?.profile?.role === "mcu");
  if (mcus.length !== 1) {
    issues.push({ code: "no_controller", severity: "block", message: `The plan must use exactly one controller board (found ${mcus.length}).`, parts: mcus.map((m) => m.ref), pins: [], hint: "Use one mcu part as U1." });
  } else {
    const langs = lookup(mcus[0]!.part_id)!.profile!.languages;
    const ext = plan.language === "micropython" ? ".py" : ".ino";
    if (!langs.includes(plan.language) || !plan.code.filename.endsWith(ext)) {
      issues.push({
        code: "code_language_mismatch",
        severity: "block",
        message: `${mcus[0]!.ref} runs ${langs.join("/")}; the code must be ${langs[0]} with a ${langs[0] === "micropython" ? ".py" : ".ino"} file.`,
        parts: [mcus[0]!.ref],
        pins: [],
        hint: `Set language to one of ${langs.join(", ")} and filename extension ${ext === ".py" ? ".py" : ".ino"} accordingly.`,
      });
    }
  }
  return issues;
}

function schemaIssues(err: z.ZodError): Issue[] {
  return err.issues.slice(0, 8).map((i) => ({
    code: "plan_schema_invalid" as const,
    severity: "block" as const,
    message: `Output field ${i.path.join(".") || "(root)"}: ${i.message}`.slice(0, 400),
    parts: [],
    pins: [],
    hint: "Return JSON that matches the schema exactly.",
  }));
}

interface Attempted {
  plan: PlannerOutput;
  report: ValidationReport;
}

/** One goal → planned, validated (≤ 3 repairs) and rendered result. */
export async function planSingle(
  deps: PlannerDeps,
  req: { id: string; goal: string; inventory: InventoryLine[]; lookup: (id: string) => CatalogPart | undefined; refHint?: string | null; languageHint?: CodeLanguage | null; onStage?: PlanRequest["onStage"] },
): Promise<PlanResult> {
  const refs = await retrieveReferences(deps, req.goal, req.refHint);
  const profiled = await deps.profiled();
  const inventory = req.inventory.map((i) => ({ part_id: i.part_id, name: req.lookup(i.part_id)?.name ?? i.part_id, qty: i.quantity }));
  const base = {
    goal: req.goal,
    language_hint: req.languageHint ?? null,
    inventory,
    references: refs.map((r) => ({ id: r.id, title: r.title, plan: r.plan })),
    allowed_parts: describeAllowedParts(profiled),
  };

  let best: Attempted | null = null;
  let feedback: { previous_plan: unknown; issues: Pick<Issue, "code" | "message" | "hint">[] } | null = null;
  const maxCalls = 1 + LIMITS.MAX_REPAIR_ATTEMPTS;
  let calls = 0;
  for (; calls < maxCalls; ) {
    calls++;
    const raw = await deps.provider.generateJson({
      system: feedback ? `${PLAN_SYSTEM}\n\n${REPAIR_SUFFIX}` : PLAN_SYSTEM,
      parts: [{ text: dataBlock(feedback ? { ...base, ...feedback } : base) }],
      schema: PLANNER_SCHEMA,
      temperature: feedback ? 0.2 : 0.3,
    });
    if (calls === 1) await req.onStage?.("validating");
    const parsed = PlannerOutput.safeParse(raw);
    let report: ValidationReport;
    if (!parsed.success) {
      report = { passed: false, refused: false, issues: schemaIssues(parsed.error) };
    } else {
      const rules = validatePlan(parsed.data, req.lookup);
      if (rules.refused) return refusalResult(req.id, rules, calls);
      const issues = [...planIssues(parsed.data, req.lookup), ...rules.issues];
      report = { passed: issues.length === 0, refused: false, issues };
      if (!best || issues.length < best.report.issues.length) best = { plan: parsed.data, report };
    }
    if (report.passed) break;
    feedback = {
      previous_plan: parsed.success ? parsed.data : raw,
      issues: report.issues.slice(0, 20).map((i) => ({ code: i.code, message: i.message, hint: i.hint })),
    };
  }
  if (!best) throw new ModelError("model_output_invalid", false, "planner_schema");

  await req.onStage?.("rendering");
  const diagram = best.report.passed ? buildDiagram(best.plan, req.lookup) : null;
  return toPlanResult({ id: req.id, plan: best.plan, validation: best.report, attempts: calls, inventory: req.inventory, lookup: req.lookup, diagram });
}

/** Deterministic fallback ideas: references whose parts the user mostly owns. */
export function ideasFromInventory(refs: ReferenceRow[], inventory: InventoryLine[]): DiscoveryOutput["ideas"] {
  const have = new Set(inventory.map((i) => i.part_id));
  return refs
    .map((r) => {
      const ids = r.plan.parts.map((p) => p.part_id);
      return { r, cover: ids.filter((id) => have.has(id)).length / Math.max(1, ids.length) };
    })
    .sort((a, b) => b.cover - a.cover || a.r.id.localeCompare(b.r.id))
    .slice(0, LIMITS.DISCOVERY_IDEAS)
    .map(({ r }) => ({ title: r.title.slice(0, 80), goal: r.goal_examples?.[0] ?? r.title, reference_project_id: r.id }));
}

export async function planJob(deps: PlannerDeps, req: PlanRequest): Promise<{ intent: "specific" | "discovery"; payload: JobResultPayload }> {
  await req.onStage?.("planning");
  const profiled = await deps.profiled();
  const extra = await deps.catalog.getParts(req.parts.map((p) => p.part_id).filter((id) => !profiled.some((x) => x.id === id)));
  const byId = new Map([...profiled, ...extra].map((p) => [p.id, p]));
  const lookup = (id: string) => byId.get(id);

  const intent = await classifyIntent(deps.provider, req.goal);
  if (intent.hazard !== "none") {
    const code = intent.hazard === "mains" ? "refuse_mains" : intent.hazard === "high_voltage" ? "refuse_high_voltage" : "refuse_weapon";
    const message =
      intent.hazard === "mains"
        ? "This request involves mains (wall) voltage, which can kill. PartsPilot only plans low-voltage builds."
        : "PartsPilot does not help with builds designed to harm people or with dangerous high-voltage devices.";
    const report: ValidationReport = { passed: false, refused: true, issues: [{ code, severity: "refuse", message, parts: [], pins: [] }] };
    return {
      intent: "specific",
      payload: { kind: "refusal", plan_version: req.planVersion, plans: [refusalResult(`${req.planVersion}-0`, report, 0)], refusal: { code, message } },
    };
  }
  const languageHint = req.languageHint ?? intent.language_hint;

  if (intent.intent === "discovery") {
    const refs = await deps.references();
    let ideas = ideasFromInventory(refs, req.parts);
    try {
      const out = await deps.provider.generateJson({
        system: DISCOVERY_SYSTEM,
        parts: [
          {
            text: dataBlock({
              goal: req.goal,
              inventory: req.parts.map((p) => ({ part_id: p.part_id, name: lookup(p.part_id)?.name ?? p.part_id, qty: p.quantity })),
              references: refs.map((r) => ({ id: r.id, title: r.title, parts: r.plan.parts.map((p) => p.part_id) })),
            }),
          },
        ],
        schema: DISCOVERY_SCHEMA,
        temperature: 0.5,
      });
      const parsed = DiscoveryOutput.safeParse(out);
      if (parsed.success) ideas = parsed.data.ideas;
    } catch {
      // keep the deterministic ideas
    }
    const results = await Promise.allSettled(
      ideas.map((idea, i) =>
        planSingle(deps, { id: `${req.planVersion}-${i}`, goal: idea.goal, inventory: req.parts, lookup, refHint: idea.reference_project_id, languageHint }).then((p) => ({
          ...p,
          title: idea.title,
        })),
      ),
    );
    const plans = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (plans.length === 0) {
      const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw first?.reason ?? new ModelError("model_output_invalid", false, "discovery");
    }
    return { intent: "discovery", payload: { kind: "discovery", plan_version: req.planVersion, plans, refusal: null } };
  }

  const plan = await planSingle(deps, { id: `${req.planVersion}-0`, goal: req.goal, inventory: req.parts, lookup, languageHint, onStage: req.onStage });
  const kind = plan.verdict === "refused" ? "refusal" : "single";
  return {
    intent: "specific",
    payload: {
      kind,
      plan_version: req.planVersion,
      plans: [plan],
      refusal: kind === "refusal" ? { code: plan.validation.issues[0]?.code ?? "refuse_mains", message: plan.safety_notes[0] ?? "Refused." } : null,
    },
  };
}
