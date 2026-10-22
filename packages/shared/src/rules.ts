import { z } from "zod";

export const PinRef = z.object({
  ref: z.string().regex(/^[A-Z]{1,4}\d{1,3}$/, "refs look like U1, M2, R10"),
  pin: z.string().min(1).max(24),
});
export type PinRef = z.infer<typeof PinRef>;

export const IssueCode = z.enum([
  // structure
  "unknown_part",
  "part_without_profile",
  "unknown_pin",
  "unknown_ref",
  "duplicate_ref",
  "self_connection",
  "plan_schema_invalid",
  "no_controller",
  "code_language_mismatch",
  // voltage
  "voltage_mismatch",
  "supply_voltage_out_of_range",
  // drivers / loads
  "driver_required",
  "led_needs_resistor",
  // ground
  "missing_ground",
  "no_common_ground",
  // current / power
  "pin_current_exceeded",
  "mcu_current_exceeded",
  "power_budget_exceeded",
  "no_power_source",
  "part_unpowered",
  "power_sources_shorted",
  "short_circuit",
  // pins
  "pin_reused",
  "output_conflict",
  "input_only_as_output",
  "reserved_pin",
  "pin_capability",
  // refusals (never repaired)
  "refuse_mains",
  "refuse_lipo_unprotected",
  "refuse_weapon",
  "refuse_high_voltage",
]);
export type IssueCode = z.infer<typeof IssueCode>;

export const REFUSAL_CODES: readonly IssueCode[] = [
  "refuse_mains",
  "refuse_lipo_unprotected",
  "refuse_weapon",
  "refuse_high_voltage",
];

export const Issue = z.object({
  code: IssueCode,
  /** Every rule-engine issue blocks; refusals additionally stop the repair loop. */
  severity: z.enum(["block", "refuse"]),
  message: z.string().max(400),
  parts: z.array(z.string()).default([]),
  pins: z.array(PinRef).default([]),
  /** Machine-oriented fix hint fed back to the planner during repair. */
  hint: z.string().max(400).optional(),
});
export type Issue = z.infer<typeof Issue>;

export const ValidationReport = z.object({
  passed: z.boolean(),
  refused: z.boolean(),
  issues: z.array(Issue),
});
export type ValidationReport = z.infer<typeof ValidationReport>;
