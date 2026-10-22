import type { CatalogPart, PlannerOutput } from "@partspilot/shared";

export interface CatalogMatchRow {
  part_id: string;
  name: string;
  has_profile: boolean;
  alias: string;
  vec_sim: number;
  trgm_sim: number;
}

export interface ReferenceRow {
  id: string;
  title: string;
  goal_examples?: string[];
  plan: PlannerOutput;
  similarity?: number;
}

/** What the AI layer needs from the database (implemented by the Worker's repo). */
export interface CatalogAccess {
  matchCatalog(embedding: number[] | null, query: string, k: number): Promise<CatalogMatchRow[]>;
  getParts(ids: string[]): Promise<CatalogPart[]>;
  listProfiledParts(): Promise<CatalogPart[]>;
  matchReferenceProjects(embedding: number[], k: number): Promise<ReferenceRow[]>;
  listReferenceProjects(): Promise<ReferenceRow[]>;
}
