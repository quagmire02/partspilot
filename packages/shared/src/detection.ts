import { z } from "zod";
import { LIMITS } from "./limits";

const unit = z.number().min(0).max(1);

/** Normalized box, origin top-left, all values in [0, 1] of the image size. */
export const BBox = z
  .object({ x: unit, y: unit, w: unit, h: unit })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, "bbox exceeds image");
export type BBox = z.infer<typeof BBox>;

export const ImageQuality = z.enum(["ok", "blurry", "too_dark", "no_electronics"]);
export type ImageQuality = z.infer<typeof ImageQuality>;

/** One detected item, provider-normalized. Labels and visible text are untrusted data. */
export const DetectionItem = z.object({
  label: z.string().trim().min(1).max(120),
  bbox: BBox,
  confidence: unit,
  visible_text: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  quantity: z.number().int().min(1).max(50).default(1),
});
export type DetectionItem = z.infer<typeof DetectionItem>;

export const ImageDetection = z.object({
  image_index: z.number().int().min(0).max(LIMITS.MAX_PHOTOS - 1),
  quality: ImageQuality,
  items: z.array(DetectionItem).max(LIMITS.MAX_DETECTIONS_PER_IMAGE),
});
export type ImageDetection = z.infer<typeof ImageDetection>;

export const MatchCandidate = z.object({
  part_id: z.string(),
  name: z.string(),
  /** Calibrated confidence in [0, 1]. */
  score: unit,
});
export type MatchCandidate = z.infer<typeof MatchCandidate>;
