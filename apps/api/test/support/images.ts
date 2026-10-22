/** Minimal, structurally valid image containers for sanitizer tests (pixels are not decodable). */

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[])[]) => {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];

const segment = (marker: number, payload: Uint8Array | number[]) => {
  const p = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  return cat([0xff, marker], be16(p.length + 2), p);
};

export const SECRET = "GPS 37.7749N 122.4194W serial#A1B2C3";

export function jpeg(w = 1024, h = 768, opts: { exif?: boolean; padTo?: number } = {}): Uint8Array {
  const parts: Uint8Array[] = [
    Uint8Array.from([0xff, 0xd8]),
    segment(0xe0, cat(enc("JFIF\0"), [1, 1, 0, 0, 1, 0, 1, 0, 0])),
  ];
  if (opts.exif !== false) {
    parts.push(segment(0xe1, cat(enc("Exif\0\0"), enc(SECRET))));
    parts.push(segment(0xe2, cat(enc("ICC_PROFILE\0"), enc("device-profile"))));
    parts.push(segment(0xfe, enc(`comment ${SECRET}`)));
  }
  parts.push(segment(0xdb, new Uint8Array(65)));
  parts.push(segment(0xc0, [8, ...be16(h), ...be16(w), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]));
  parts.push(segment(0xc4, new Uint8Array(20)));
  parts.push(segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]));
  const scanLen = Math.max(64, (opts.padTo ?? 0) - parts.reduce((n, p) => n + p.length, 0) - 2);
  parts.push(new Uint8Array(scanLen).fill(0x5a));
  parts.push(Uint8Array.from([0xff, 0xd9]));
  return cat(...parts);
}

const pngChunk = (type: string, data: Uint8Array | number[]) => {
  const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return cat(be32(d.length), enc(type), d, [0, 0, 0, 0]);
};

export function png(w = 1024, h = 768, opts: { text?: boolean } = {}): Uint8Array {
  return cat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", [...be32(w), ...be32(h), 8, 2, 0, 0, 0]),
    ...(opts.text !== false ? [pngChunk("tEXt", enc(`Comment\0${SECRET}`)), pngChunk("eXIf", enc(SECRET))] : []),
    pngChunk("IDAT", new Uint8Array(32)),
    pngChunk("IEND", []),
  );
}

const riffChunk = (fourcc: string, data: Uint8Array | number[]) => {
  const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return cat(enc(fourcc), le32(d.length), d, d.length & 1 ? [0] : []);
};

export function webp(w = 1024, h = 768, opts: { exif?: boolean } = {}): Uint8Array {
  const flags = opts.exif !== false ? 0x08 | 0x04 : 0;
  const vp8 = cat([0, 0, 0, 0x9d, 0x01, 0x2a], [w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f], new Uint8Array(10));
  const body = cat(
    enc("WEBP"),
    riffChunk("VP8X", [flags, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]),
    riffChunk("VP8 ", vp8),
    ...(opts.exif !== false ? [riffChunk("EXIF", enc(SECRET)), riffChunk("XMP ", enc(`<x>${SECRET}</x>`))] : []),
  );
  return cat(enc("RIFF"), le32(body.length), body);
}

export function heic(): Uint8Array {
  return cat(be32(24), enc("ftypheic"), [0, 0, 0, 0], enc("mif1heic"), new Uint8Array(64));
}

export function includes(hay: Uint8Array, needle: string): boolean {
  return Buffer.from(hay).includes(Buffer.from(needle));
}
