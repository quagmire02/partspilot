import type { CatalogPart, CodeLanguage, ImageDetection, JobResultPayload, JobStage, MatchCandidate } from "@partspilot/shared";
import type { CatalogAccess, ReferenceRow } from "./catalog";
import { detectAll } from "./detect";
import { matchItems, type MatchItem } from "./matcher";
import { planJob } from "./planner";
import type { ModelProvider } from "./provider";

export interface Engine {
  readonly name: string;
  detect(images: { index: number; bytes: Uint8Array; mime: string }[]): Promise<ImageDetection[]>;
  match(items: MatchItem[]): Promise<MatchCandidate[][]>;
  plan(input: {
    goal: string;
    parts: { part_id: string; quantity: number }[];
    planVersion: number;
    languageHint?: CodeLanguage | null;
    onStage?: (stage: Extract<JobStage, "planning" | "validating" | "rendering">) => Promise<void>;
  }): Promise<{ intent: "specific" | "discovery"; payload: JobResultPayload }>;
}

const TTL_MS = 10 * 60 * 1000;

function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let value: { at: number; v: Promise<T> } | null = null;
  return () => {
    if (!value || Date.now() - value.at > TTL_MS) {
      const v = load();
      value = { at: Date.now(), v };
      v.catch(() => (value = null));
    }
    return value.v;
  };
}

/** Wires a model provider and catalog access into the three pipeline operations. */
export function createEngine(opts: { provider: ModelProvider; catalog: CatalogAccess }): Engine {
  const profiled = cached<CatalogPart[]>(() => opts.catalog.listProfiledParts());
  const references = cached<ReferenceRow[]>(() => opts.catalog.listReferenceProjects());
  const deps = { provider: opts.provider, catalog: opts.catalog, profiled, references };
  return {
    name: opts.provider.name,
    detect: (images) => detectAll(opts.provider, images),
    match: (items) => matchItems(items, opts.catalog, opts.provider),
    plan: (input) => planJob(deps, input),
  };
}
