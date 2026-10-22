import { LIMITS } from "@partspilot/shared";
import { HttpError } from "./errors.js";

/**
 * Upload sanitizer: magic-byte sniffing (the client's Content-Type is ignored),
 * metadata stripping (EXIF/XMP/ICC/comments/text chunks) and dimension checks,
 * done by walking the container structure — pixels are never decoded or re-encoded.
 */

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export interface CleanImage {
  bytes: Uint8Array;
  mime: ImageMime;
  width: number;
  height: number;
  sha256: string;
}

type Sniffed = ImageMime | "heic" | "unknown";

const MAX_DIMENSION = 12000;
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif", "avis"]);

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

export function sniff(b: Uint8Array): Sniffed {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && ascii(b, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp" && HEIF_BRANDS.has(ascii(b, 8, 4))) return "heic";
  return "unknown";
}

const corrupt = () => new HttpError("image_corrupt");

// --- JPEG ------------------------------------------------------------------

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Keeps APP0 (JFIF) and APP14 (Adobe colour transform); drops APP1-13, APP15 and COM. */
function stripJpeg(b: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) throw corrupt();
    while (b[i] === 0xff && i < b.length) i++; // fill bytes
    const marker = b[i];
    if (marker === undefined) throw corrupt();
    i++;
    if (marker === 0xd9) {
      out.push(Uint8Array.of(0xff, 0xd9));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (i + 2 > b.length) throw corrupt();
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2 || i + len > b.length) throw corrupt();
    if (marker === 0xda) {
      // Start of scan: entropy-coded data follows; copy the remainder verbatim.
      if (!width || !height) throw corrupt();
      out.push(Uint8Array.of(0xff, marker), b.subarray(i));
      i = b.length;
      break;
    }
    if (JPEG_SOF.has(marker)) {
      if (len < 7) throw corrupt();
      height = (b[i + 3]! << 8) | b[i + 4]!;
      width = (b[i + 5]! << 8) | b[i + 6]!;
    }
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) out.push(Uint8Array.of(0xff, marker), b.subarray(i, i + len));
    i += len;
  }
  if (!width || !height) throw corrupt();
  return { bytes: concat(out), width, height };
}

// --- PNG -------------------------------------------------------------------

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD"]);

function stripPng(b: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = view.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) throw corrupt();
    if (i === 8) {
      if (type !== "IHDR" || len < 8) throw corrupt();
      width = view.getUint32(i + 8);
      height = view.getUint32(i + 12);
    }
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !width || !height) throw corrupt();
  return { bytes: concat(out), width, height };
}

// --- WebP ------------------------------------------------------------------

function stripWebp(b: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = Math.min(b.length, 8 + view.getUint32(4, true));
  const chunks: Uint8Array[] = [];
  let i = 12;
  let width = 0;
  let height = 0;
  while (i + 8 <= riffEnd) {
    const fourcc = ascii(b, i, 4);
    const size = view.getUint32(i + 4, true);
    const dataStart = i + 8;
    const end = dataStart + size + (size & 1);
    if (dataStart + size > riffEnd) throw corrupt();
    const d = b.subarray(dataStart, dataStart + size);
    if (fourcc === "VP8X" && size >= 10) {
      width = (d[4]! | (d[5]! << 8) | (d[6]! << 16)) + 1;
      height = (d[7]! | (d[8]! << 8) | (d[9]! << 16)) + 1;
      const copy = b.slice(i, Math.min(end, riffEnd));
      copy[8] = copy[8]! & ~(0x08 | 0x04); // clear EXIF and XMP flags
      chunks.push(copy);
    } else if (fourcc === "VP8 " && size >= 10) {
      if (!width) {
        if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw corrupt();
        width = (d[6]! | (d[7]! << 8)) & 0x3fff;
        height = (d[8]! | (d[9]! << 8)) & 0x3fff;
      }
      chunks.push(b.subarray(i, Math.min(end, riffEnd)));
    } else if (fourcc === "VP8L" && size >= 5) {
      if (!width) {
        if (d[0] !== 0x2f) throw corrupt();
        const bits = d[1]! | (d[2]! << 8) | (d[3]! << 16) | (d[4]! << 24);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      chunks.push(b.subarray(i, Math.min(end, riffEnd)));
    } else if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      chunks.push(b.subarray(i, Math.min(end, riffEnd)));
    }
    i = end;
  }
  if (!width || !height) throw corrupt();
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return { bytes: concat([header, body]), width, height };
}

// --- entry point -----------------------------------------------------------

export async function cleanImage(input: Uint8Array): Promise<CleanImage> {
  if (input.length > LIMITS.MAX_PHOTO_BYTES) throw new HttpError("payload_too_large");
  const kind = sniff(input);
  if (kind === "heic") throw new HttpError("heic_not_converted");
  if (kind === "unknown") throw new HttpError("unsupported_media_type");
  const stripped = kind === "image/jpeg" ? stripJpeg(input) : kind === "image/png" ? stripPng(input) : stripWebp(input);
  const { width, height } = stripped;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new HttpError("image_corrupt");
  if (Math.min(width, height) < LIMITS.MIN_PHOTO_SHORT_EDGE_PX) throw new HttpError("image_too_small");
  return { bytes: stripped.bytes, mime: kind, width, height, sha256: await sha256Hex(stripped.bytes) };
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
