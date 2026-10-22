import { LIMITS, type MatchCandidate } from "@partspilot/shared";
import type { CatalogAccess, CatalogMatchRow } from "./catalog";
import type { ModelProvider } from "./provider";

export interface MatchItem {
  label: string;
  visible_text: string[];
  /** detector confidence; lowers match confidence for doubtful detections */
  confidence?: number;
}

const UNITS = /^\d+(?:\.\d+)?(?:V|MA|MAH|A|UF|NF|PF|K|R|OHM|MM|W|MHZ|KHZ|HZ|G|KG)$/i;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Model-number-like tokens (letters and digits mixed: L298N, HC-SR04, SG90, 28BYJ-48), as printed and normalized. */
export function modelTokenPairs(texts: string[]): { raw: string; norm: string }[] {
  const out = new Map<string, string>();
  for (const t of texts) {
    for (const m of t.matchAll(/[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)*/g)) {
      const raw = m[0];
      const n = norm(raw);
      if (n.length < 3 || n.length > 14) continue;
      if (!/\d/.test(n) || !/[A-Z]/.test(n) || UNITS.test(raw)) continue;
      if (!out.has(n)) out.set(n, raw);
    }
  }
  return [...out.entries()].map(([n, raw]) => ({ raw, norm: n }));
}

export const modelTokens = (texts: string[]): string[] => modelTokenPairs(texts).map((t) => t.norm);

interface Scored {
  row: CatalogMatchRow;
  raw: number;
  /** candidate carries a model number printed on the item */
  tokenHit: boolean;
}

export function scoreCandidates(rows: CatalogMatchRow[], tokens: string[], hasEmbedding: boolean, tokenRows: Set<string>): Scored[] {
  const byPart = new Map<string, CatalogMatchRow>();
  for (const r of rows) {
    const prev = byPart.get(r.part_id);
    byPart.set(
      r.part_id,
      prev
        ? { ...prev, vec_sim: Math.max(prev.vec_sim, r.vec_sim), trgm_sim: Math.max(prev.trgm_sim, r.trgm_sim), alias: prev.alias }
        : r,
    );
  }
  return [...byPart.values()]
    .map((row) => {
      let raw = hasEmbedding ? 0.55 * row.vec_sim + 0.45 * row.trgm_sim : row.trgm_sim;
      const hay = `${norm(row.name)}|${norm(row.alias)}`;
      const tokenHit = tokens.some((t) => hay.includes(t)) || tokenRows.has(row.part_id);
      if (tokenHit) raw += 0.3;
      if (row.has_profile) raw += 0.03;
      return { row, raw, tokenHit };
    })
    .sort((a, b) => b.raw - a.raw || a.row.part_id.localeCompare(b.row.part_id));
}

/**
 * Calibrated confidence for the top candidate: absolute strength × margin over the
 * runner-up × detector confidence. ≥ 0.85 is auto-accepted by the pipeline.
 */
export function calibrate(scored: Scored[], detectionConfidence = 1): MatchCandidate[] {
  if (scored.length === 0) return [];
  const lead = scored[0]!;
  const top = lead.raw;
  // A Fritzing twin of a curated part (same printed model number, no electrical profile) is
  // the same product, not a competing guess: measure the margin against the next real rival.
  const isTwin = (s: Scored) => lead.row.has_profile && lead.tokenHit && s.tokenHit && !s.row.has_profile;
  const second = scored.slice(1).find((s) => !isTwin(s))?.raw ?? 0;
  const margin = Math.min(1, (top - second) / 0.12);
  const detFactor = 0.75 + 0.25 * Math.min(1, Math.max(0, detectionConfidence));
  const conf1 = Math.min(0.99, Math.min(1, top) * (0.7 + 0.3 * margin) * detFactor);
  return scored.slice(0, LIMITS.TOP_K_MATCHES).map((s, i) => ({
    part_id: s.row.part_id,
    name: s.row.name,
    score: i === 0 ? round(conf1) : round(Math.min(conf1 - 0.01 * i, Math.min(1, s.raw) * 0.8 * detFactor)),
  }));
}

const round = (v: number) => Math.max(0, Math.round(v * 1000) / 1000);

export async function matchItems(items: MatchItem[], catalog: CatalogAccess, provider?: ModelProvider): Promise<MatchCandidate[][]> {
  if (items.length === 0) return [];
  const texts = items.map((it) => [it.label, ...it.visible_text].join(" — ").slice(0, 300));
  let embeddings: (number[] | null)[] = items.map(() => null);
  if (provider) {
    try {
      embeddings = await provider.embed(texts, "query");
    } catch {
      embeddings = items.map(() => null); // degrade to lexical matching
    }
  }
  return Promise.all(
    items.map(async (it, i) => {
      const pairs = modelTokenPairs([it.label, ...it.visible_text]);
      const tokens = pairs.map((t) => t.norm);
      const queries = [it.label, ...it.visible_text.filter((t) => t.length >= 3).slice(0, 3)];
      const rows = (
        await Promise.all([
          catalog.matchCatalog(embeddings[i] ?? null, queries[0]!, 20),
          ...queries.slice(1).map((q) => catalog.matchCatalog(null, q, 8)),
          ...pairs.slice(0, 3).map((t) => catalog.matchCatalog(null, t.raw, 8)),
        ])
      ).flat();
      const tokenRows = new Set(
        rows.filter((r) => r.trgm_sim >= 0.6 && tokens.some((t) => norm(r.alias).includes(t))).map((r) => r.part_id),
      );
      return calibrate(scoreCandidates(rows, tokens, embeddings[i] != null, tokenRows), it.confidence ?? 1);
    }),
  );
}
