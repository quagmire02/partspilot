import { CURATED_BY_ID, CURATED_PARTS, REFERENCE_PROJECTS } from "@partspilot/data";
import type { CatalogAccess, CatalogMatchRow, ReferenceRow } from "../src/catalog";

export const refs: ReferenceRow[] = REFERENCE_PROJECTS.map((r) => ({ id: r.id, title: r.title, goal_examples: r.goal_examples, plan: r.plan }));

export function memoryCatalog(rows: CatalogMatchRow[] = []): CatalogAccess & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async matchCatalog(_e, q) {
      calls.push(q);
      return rows.filter((r) => r.alias.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(r.alias.toLowerCase()) || rows.length < 6);
    },
    async getParts(ids) {
      return ids.flatMap((id) => (CURATED_BY_ID.get(id) ? [CURATED_BY_ID.get(id)!] : []));
    },
    async listProfiledParts() {
      return CURATED_PARTS;
    },
    async matchReferenceProjects() {
      return [];
    },
    async listReferenceProjects() {
      return refs;
    },
  };
}

export const lookup = (id: string) => CURATED_BY_ID.get(id);
