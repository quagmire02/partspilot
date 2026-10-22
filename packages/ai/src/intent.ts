import { IntentOutput, type GoalHazard } from "@partspilot/shared";
import { dataBlock, INTENT_SYSTEM } from "./prompts";
import type { ModelProvider } from "./provider";

const HAZARDS: [GoalHazard, RegExp][] = [
  [
    "weapon",
    /(?<!\b(?:glue|heat|solder|soldering|spray|nail|caulk|staple)\s)\bguns?\b|\b(rifle|pistol|taser|stun ?gun|weapon|explosive|bomb|detonat\w*|grenade|flamethrower|rail ?gun|coil ?gun|gauss ?gun|shock (?:someone|people|a person)|projectile launcher|crossbow)\b/i,
  ],
  ["high_voltage", /\b(tesla coil|arc generator|plasma (?:speaker|generator)|high[- ]voltage (?:generator|module)|400 ?kv|marx generator|zvs (?:driver|flyback))\b/i],
  ["mains", /\b(mains|wall (?:outlet|socket|plug|power)|power outlet|household (?:power|wiring|current)|(?:110|115|120|220|230|240) ?v(?:olts?)?(?: ac)?|ac (?:mains|power|lamp|bulb)|light bulb socket|e27)\b/i],
];

const DISCOVERY = /^\s*$|\bwhat (?:can|could|should) i (?:build|make|do)\b|\b(?:ideas?|suggest(?:ions?)?|inspire|surprise me)\b|\bwhat to (?:build|make)\b/i;

export function screenGoal(goal: string): { hazard: GoalHazard; discovery: boolean } {
  const hazard = HAZARDS.find(([, re]) => re.test(goal))?.[0] ?? "none";
  return { hazard, discovery: DISCOVERY.test(goal) };
}

export async function classifyIntent(provider: ModelProvider, goal: string): Promise<IntentOutput> {
  const screen = screenGoal(goal);
  if (screen.hazard !== "none") return { intent: "specific", goal_summary: "", hazard: screen.hazard, language_hint: null };
  if (screen.discovery) return { intent: "discovery", goal_summary: "", hazard: "none", language_hint: null };
  try {
    const out = await provider.generateJson({
      system: INTENT_SYSTEM,
      parts: [{ text: dataBlock({ goal }) }],
      schema: { type: "object", properties: {
        intent: { type: "string", enum: ["specific", "discovery"] },
        goal_summary: { type: "string" },
        hazard: { type: "string", enum: ["none", "mains", "weapon", "high_voltage", "other_dangerous"] },
        language_hint: { type: ["string", "null"], enum: ["arduino_cpp", "micropython", null] },
      }, required: ["intent", "goal_summary", "hazard", "language_hint"] },
      temperature: 0,
    });
    const parsed = IntentOutput.safeParse(out);
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the heuristic: a classifier failure must not fail the job
  }
  return { intent: "specific", goal_summary: goal.slice(0, 200), hazard: "none", language_hint: /micro ?python/i.test(goal) ? "micropython" : null };
}
