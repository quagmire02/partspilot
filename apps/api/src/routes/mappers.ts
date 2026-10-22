import type { CatalogPart, Job, JobPart } from "@partspilot/shared";
import type { JobPartRow, JobRow } from "../db/types.js";

export function toApiJob(r: JobRow): Job {
  return {
    id: r.id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    source: r.source,
    goal: r.goal,
    intent: r.intent,
    status: r.status,
    stage: r.stage,
    plan_version: r.plan_version,
    error_code: r.error_code,
    photo_count: r.photo_count,
    summary: r.summary,
  };
}

export function toApiPart(r: JobPartRow, catalog: Map<string, CatalogPart>): JobPart {
  const name = r.part_id
    ? (catalog.get(r.part_id)?.name ?? r.candidates.find((c) => c.part_id === r.part_id)?.name ?? null)
    : null;
  return {
    id: r.id,
    image_index: r.image_index,
    bbox: r.bbox,
    label: r.label,
    visible_text: r.visible_text,
    candidates: r.candidates.slice(0, 3),
    part_id: r.part_id,
    name,
    confidence: r.confidence,
    quantity: r.quantity,
    status: r.status,
    duplicate: r.duplicate,
  };
}
