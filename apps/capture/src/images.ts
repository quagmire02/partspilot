"use client";

import { LIMITS } from "@partspilot/shared";

/** Longest edge sent to the server: enough to read chip markings, small enough to upload fast. */
export const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.8;

export type PhotoWarning = "blurry" | "too_dark";

export interface Photo {
  id: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  warning: PhotoWarning | null;
}

export class PhotoError extends Error {
  constructor(readonly code: "unreadable" | "too_small") {
    super(code);
  }
}

const isHeic = (f: Blob) => /image\/hei[cf]/i.test(f.type) || (f instanceof File && /\.hei[cf]$/i.test(f.name));

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (!isHeic(file)) throw new PhotoError("unreadable");
    // Browsers without native HEIC decoding (Chrome on Android/desktop): convert in WASM.
    const { default: heic2any } = await import("heic2any");
    const jpeg = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 })) as Blob;
    return createImageBitmap(jpeg);
  }
}

/**
 * Re-encodes every photo through a canvas: applies EXIF orientation, converts HEIC to
 * JPEG, strips all metadata (location, device), and caps the size. Runs at capture time
 * so pressing Send only uploads.
 */
export async function normalizePhoto(file: Blob): Promise<Photo> {
  const bitmap = await decode(file);
  if (Math.min(bitmap.width, bitmap.height) < LIMITS.MIN_PHOTO_SHORT_EDGE_PX) {
    bitmap.close();
    throw new PhotoError("too_small");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const warning = qualityWarning(ctx, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError("unreadable"))), "image/jpeg", JPEG_QUALITY),
  );
  return { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), width, height, warning };
}

function qualityWarning(ctx: CanvasRenderingContext2D, w: number, h: number): PhotoWarning | null {
  const size = 160;
  const small = document.createElement("canvas");
  small.width = size;
  small.height = Math.max(1, Math.round((size * h) / w));
  const sctx = small.getContext("2d")!;
  sctx.drawImage(ctx.canvas, 0, 0, small.width, small.height);
  const { data } = sctx.getImageData(0, 0, small.width, small.height);
  return assessQuality(data, small.width, small.height);
}

/** Mean luminance and variance of the Laplacian on a small greyscale copy. */
export function assessQuality(rgba: Uint8ClampedArray, w: number, h: number): PhotoWarning | null {
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
    gray[i] = g;
    sum += g;
  }
  if (sum / (w * h) < 45) return "too_dark";
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w]! + gray[i + w]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      n++;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  return n > 0 && m2 / n < 60 ? "blurry" : null;
}

/** Grabs a full-resolution still from the live camera (ImageCapture where available). */
export async function captureFrame(video: HTMLVideoElement, track: MediaStreamTrack | null): Promise<Blob> {
  const IC = (globalThis as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
  if (IC && track) {
    try {
      return await new IC(track).takePhoto();
    } catch {
      // fall back to a video frame
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError("unreadable"))), "image/jpeg", 0.92));
}
