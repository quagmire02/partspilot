import { describe, expect, it } from "vitest";
import { CURATED_BY_ID, REFERENCE_PROJECTS } from "../src/index";

describe("reference projects", () => {
  it("has 30 uniquely named projects", () => {
    expect(REFERENCE_PROJECTS).toHaveLength(30);
    expect(new Set(REFERENCE_PROJECTS.map((p) => p.id)).size).toBe(30);
  });

  it("covers the RC car demo goal", () => {
    const rc = REFERENCE_PROJECTS.filter((p) => p.goal_examples.some((g) => /rc car|remote control car/i.test(g)));
    expect(rc.length).toBeGreaterThanOrEqual(2);
  });

  it.each(REFERENCE_PROJECTS.map((p) => [p.id, p] as const))("%s uses catalog parts and real pin names", (_, p) => {
    const refs = new Map(p.plan.parts.map((x) => [x.ref, x.part_id]));
    expect(refs.size, "duplicate refs").toBe(p.plan.parts.length);
    for (const x of p.plan.parts) expect(CURATED_BY_ID.has(x.part_id), x.part_id).toBe(true);
    for (const c of p.plan.connections) {
      for (const end of [c.from, c.to]) {
        const partId = refs.get(end.ref);
        expect(partId, `unknown ref ${end.ref}`).toBeDefined();
        const pins = CURATED_BY_ID.get(partId!)!.profile!.pins;
        const known = pins.some((pin) => [pin.name, ...pin.aliases].some((n) => n.toLowerCase() === end.pin.toLowerCase()));
        expect(known, `${p.id}: ${end.ref}.${end.pin} not on ${partId}`).toBe(true);
      }
    }
    const mcu = p.plan.parts.find((x) => CURATED_BY_ID.get(x.part_id)!.profile!.role === "mcu");
    expect(mcu, "every project has a controller").toBeDefined();
    expect(CURATED_BY_ID.get(mcu!.part_id)!.profile!.languages).toContain(p.plan.language);
    expect(p.plan.code.filename.endsWith(p.plan.language === "micropython" ? ".py" : ".ino")).toBe(true);
  });
});
