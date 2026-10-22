import { PlannerOutput } from "@partspilot/shared";
import { BASIC_PROJECTS } from "./basics";
import { DEVICE_PROJECTS } from "./devices";
import { ROBOT_PROJECTS } from "./robots";

export type { ReferenceProject } from "./dsl";

/** 30 hand-validated builds: planner few-shot context and rule-engine golden tests. */
export const REFERENCE_PROJECTS = [...BASIC_PROJECTS, ...ROBOT_PROJECTS, ...DEVICE_PROJECTS].map((p) => ({
  ...p,
  plan: PlannerOutput.parse({ ...p.plan, reference_project_id: p.id }),
}));
