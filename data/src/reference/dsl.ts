import type { Connection, PlannerOutputInput } from "@partspilot/shared";

export interface ReferenceProject {
  id: string;
  title: string;
  /** Phrases users might type; used for retrieval embeddings. */
  goal_examples: string[];
  plan: PlannerOutputInput;
}

/** "U1.D13 > R1.1" → { from: { ref: "U1", pin: "D13" }, to: { ref: "R1", pin: "1" } }. Pins may contain dots. */
export function wires(...lines: string[]): Connection[] {
  return lines.map((line) => {
    const [a, b] = line.split(/\s+>\s+/);
    if (!a || !b) throw new Error(`bad wire: ${line}`);
    return { from: pinRef(a), to: pinRef(b) };
  });
}

function pinRef(s: string) {
  const i = s.indexOf(".");
  if (i < 1) throw new Error(`bad pin ref: ${s}`);
  return { ref: s.slice(0, i), pin: s.slice(i + 1) };
}

export const cpp = (strings: TemplateStringsArray, ...values: unknown[]) =>
  String.raw({ raw: strings }, ...values).replace(/^\n/, "");
