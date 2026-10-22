// Generates the PWA icons (plain PNG via zlib; no image dependencies). Run: pnpm icons
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const ACCENT = [0x1d, 0x4e, 0xd8];
const WHITE = [0xff, 0xff, 0xff];

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x / size, y / size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A chip glyph (body + 3 pins per side) centred in `inset`. */
function glyph(u, v, inset) {
  const s = (t) => (t - inset) / (1 - 2 * inset);
  const x = s(u);
  const y = s(v);
  const body = x > 0.25 && x < 0.75 && y > 0.25 && y < 0.75;
  const hole = (x - 0.36) ** 2 + (y - 0.36) ** 2 < 0.004;
  const pin = (p) => [0.33, 0.5, 0.67].some((c) => Math.abs(p - c) < 0.045);
  const pins = ((x > 0.12 && x <= 0.25) || (x >= 0.75 && x < 0.88)) && pin(y);
  const pinsV = ((y > 0.12 && y <= 0.25) || (y >= 0.75 && y < 0.88)) && pin(x);
  return (body && !hole) || pins || pinsV;
}

const rounded = (u, v, r) => {
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
};

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(
    new URL(`../public/icons/icon-${size}.png`, import.meta.url),
    png(size, (u, v) => (!rounded(u, v, 0.18) ? [0, 0, 0, 0] : glyph(u, v, 0.08) ? [...WHITE, 255] : [...ACCENT, 255])),
  );
}
writeFileSync(new URL("../public/icons/maskable-512.png", import.meta.url), png(512, (u, v) => (glyph(u, v, 0.2) ? [...WHITE, 255] : [...ACCENT, 255])));
console.log("icons written");
