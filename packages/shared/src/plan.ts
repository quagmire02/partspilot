import { z } from "zod";
import { CodeLanguage } from "./catalog";
import { Issue, PinRef } from "./rules";
import { LIMITS } from "./limits";

// ---------------------------------------------------------------------------
// Model outputs. Every model response must parse against one of these or it is
// rejected. They are deliberately small: ids and pin names only — names, links and
// the final verdict are filled in by server code from the catalog.
// ---------------------------------------------------------------------------

export const GoalHazard = z.enum(["none", "mains", "weapon", "high_voltage", "other_dangerous"]);
export type GoalHazard = z.infer<typeof GoalHazard>;

export const IntentOutput = z.object({
  intent: z.enum(["specific", "discovery"]),
  /** Short neutral restatement of the goal, used as planner input. */
  goal_summary: z.string().trim().max(200),
  hazard: GoalHazard,
  language_hint: CodeLanguage.nullable().default(null),
});
export type IntentOutput = z.infer<typeof IntentOutput>;

export const DiscoveryOutput = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(80),
        goal: z.string().trim().min(3).max(200),
        reference_project_id: z.string().max(80).nullable().default(null),
      }),
    )
    .length(LIMITS.DISCOVERY_IDEAS),
});
export type DiscoveryOutput = z.infer<typeof DiscoveryOutput>;

export const Connection = z.object({
  from: PinRef,
  to: PinRef,
});
export type Connection = z.infer<typeof Connection>;

export const PowerMode = z.enum(["usb", "battery", "external"]);
export type PowerMode = z.infer<typeof PowerMode>;

export const PlannerOutput = z.object({
  title: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(3).max(400),
  feasibility: z.enum(["achievable", "closest_alternative"]),
  closest_reason: z.string().trim().max(300).nullable().default(null),
  language: CodeLanguage,
  power_mode: PowerMode,
  parts: z
    .array(
      z.object({
        ref: z.string().regex(/^[A-Z]{1,4}\d{1,3}$/),
        part_id: z.string().min(2).max(80),
        qty: z.number().int().min(1).max(50).default(1),
        purpose: z.string().trim().max(120).default(""),
      }),
    )
    .min(1)
    .max(LIMITS.MAX_PARTS_PER_JOB),
  connections: z.array(Connection).max(200),
  steps: z.array(z.string().trim().min(3).max(400)).min(1).max(30),
  code: z.object({
    filename: z.string().regex(/^[A-Za-z0-9_\-]{1,40}\.(ino|py)$/),
    source: z.string().min(10).max(20000),
  }),
  libraries: z
    .array(z.object({ name: z.string().min(1).max(80), install_hint: z.string().max(160).nullable().default(null) }))
    .max(12)
    .default([]),
  safety_notes: z.array(z.string().trim().min(3).max(300)).max(10).default([]),
  reference_project_id: z.string().max(80).nullable().default(null),
});
export type PlannerOutput = z.infer<typeof PlannerOutput>;
export type PlannerOutputInput = z.input<typeof PlannerOutput>;

// ---------------------------------------------------------------------------
// Diagram spec (deterministic, from validated connections).
// ---------------------------------------------------------------------------

export const DiagramNode = z.object({
  ref: z.string(),
  part_id: z.string(),
  label: z.string(),
  /** wokwi-elements tag, or "pp-generic" for a labelled box. */
  element: z.string(),
  attrs: z.record(z.string(), z.string()).default({}),
  /** Profile pin → element pin. Generic boxes use the profile pin names. */
  pins: z.array(z.object({ name: z.string(), element_pin: z.string() })),
});
export type DiagramNode = z.infer<typeof DiagramNode>;

export const NetKind = z.enum(["ground", "power", "signal", "load"]);
export type NetKind = z.infer<typeof NetKind>;

export const DiagramWire = z.object({
  id: z.string(),
  from: PinRef,
  to: PinRef,
  net: z.string(),
  kind: NetKind,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type DiagramWire = z.infer<typeof DiagramWire>;

export const DiagramSpec = z.object({
  version: z.literal(1),
  nodes: z.array(DiagramNode),
  wires: z.array(DiagramWire),
});
export type DiagramSpec = z.infer<typeof DiagramSpec>;

// ---------------------------------------------------------------------------
// Stored / displayed result.
// ---------------------------------------------------------------------------

export const Verdict = z.enum(["yes", "yes_missing", "no_closest", "refused"]);
export type Verdict = z.infer<typeof Verdict>;

export const BuyLink = z.object({ label: z.string(), url: z.url({ protocol: /^https$/ }) });
export type BuyLink = z.infer<typeof BuyLink>;

export const MissingPart = z.object({
  part_id: z.string(),
  name: z.string(),
  qty: z.number().int().min(1),
  buy_links: z.array(BuyLink),
});
export type MissingPart = z.infer<typeof MissingPart>;

export const BomLine = z.object({
  ref: z.string(),
  part_id: z.string(),
  name: z.string(),
  qty: z.number().int().min(1),
  purpose: z.string(),
  have: z.boolean(),
});
export type BomLine = z.infer<typeof BomLine>;

export const PlanResult = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  verdict: Verdict,
  closest_reason: z.string().nullable(),
  language: CodeLanguage.nullable(),
  power_mode: PowerMode.nullable(),
  bom: z.array(BomLine),
  missing: z.array(MissingPart),
  connections: z.array(Connection),
  steps: z.array(z.string()),
  code: z.object({ language: CodeLanguage, filename: z.string(), source: z.string() }).nullable(),
  libraries: z.array(z.object({ name: z.string(), install_hint: z.string().nullable() })),
  safety_notes: z.array(z.string()),
  validation: z.object({
    passed: z.boolean(),
    /** Planner calls made: 1 initial + up to MAX_REPAIR_ATTEMPTS repairs. */
    attempts: z.number().int().min(0),
    issues: z.array(Issue),
  }),
  diagram: DiagramSpec.nullable(),
  reference_project_id: z.string().nullable(),
});
export type PlanResult = z.infer<typeof PlanResult>;

export const JobResultPayload = z.object({
  kind: z.enum(["single", "discovery", "refusal"]),
  plan_version: z.number().int().min(0),
  plans: z.array(PlanResult).max(LIMITS.DISCOVERY_IDEAS),
  refusal: z
    .object({ code: z.string(), message: z.string() })
    .nullable()
    .default(null),
});
export type JobResultPayload = z.infer<typeof JobResultPayload>;
