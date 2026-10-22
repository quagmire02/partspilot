import { z } from "zod";
import { ImageDetection, LIMITS, type DetectionItem } from "@partspilot/shared";
import { DETECT_SYSTEM } from "./prompts";
import { ModelError, type ModelProvider } from "./provider";

/** What the model returns (Gemini-native box format). Converted to the shared contract below. */
export const RawDetection = z.object({
  image_quality: z.enum(["ok", "blurry", "too_dark", "no_electronics"]),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        box_2d: z.array(z.number()).length(4),
        confidence: z.number().min(0).max(1),
        visible_text: z.array(z.string()).max(20).default([]),
        quantity: z.number().int().min(1).max(500).default(1),
      }),
    )
    .max(80),
});
export type RawDetection = z.infer<typeof RawDetection>;

const RAW_SCHEMA = z.toJSONSchema(RawDetection, { io: "input" }) as Record<string, unknown>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function toImageDetection(raw: RawDetection, imageIndex: number): ImageDetection {
  const items: DetectionItem[] = [];
  for (const it of raw.items) {
    const [ymin, xmin, ymax, xmax] = it.box_2d.map((v) => clamp01(v / 1000)) as [number, number, number, number];
    const x = Math.min(xmin, xmax);
    const y = Math.min(ymin, ymax);
    const w = Math.abs(xmax - xmin);
    const h = Math.abs(ymax - ymin);
    if (w < 0.005 || h < 0.005) continue;
    items.push({
      label: it.label.replace(/[\u0000-\u001f]/g, " ").slice(0, 120),
      bbox: { x: r4(x), y: r4(y), w: r4(Math.min(w, 1 - x)), h: r4(Math.min(h, 1 - y)) },
      confidence: it.confidence,
      visible_text: it.visible_text
        .map((t) => t.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 8),
      quantity: Math.min(it.quantity, 50),
    });
  }
  items.sort((a, b) => b.confidence - a.confidence);
  return ImageDetection.parse({
    image_index: imageIndex,
    quality: raw.image_quality,
    items: items.slice(0, LIMITS.MAX_DETECTIONS_PER_IMAGE),
  });
}

export async function detectImage(provider: ModelProvider, image: { index: number; bytes: Uint8Array; mime: string }): Promise<ImageDetection> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await provider.generateJson({
      system: DETECT_SYSTEM,
      parts: [{ image: { mime: image.mime, data: image.bytes } }, { text: "Detect the electronic parts in this photo." }],
      schema: RAW_SCHEMA,
      temperature: 0.1,
      highResImages: true,
    });
    const parsed = RawDetection.safeParse(out);
    if (parsed.success) return toImageDetection(parsed.data, image.index);
  }
  throw new ModelError("model_output_invalid", false, "detection_schema");
}

export async function detectAll(provider: ModelProvider, images: { index: number; bytes: Uint8Array; mime: string }[]): Promise<ImageDetection[]> {
  return Promise.all(images.map((img) => detectImage(provider, img)));
}
