// Writes src-tauri/app-icon.png (1024²); `tauri icon` derives .ico and all PNG sizes.
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 1024;
const ACCENT = [0x1d, 0x4e, 0xd8];

function glyph(u, v) {
  const inset = 0.08;
  const x = (u - inset) / (1 - 2 * inset);
  const y = (v - inset) / (1 - 2 * inset);
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

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let yy = 0; yy < SIZE; yy++) {
  raw[yy * (SIZE * 4 + 1)] = 0;
  for (let xx = 0; xx < SIZE; xx++) {
    const u = xx / SIZE;
    const v = yy / SIZE;
    const px = !rounded(u, v, 0.18) ? [0, 0, 0, 0] : glyph(u, v) ? [255, 255, 255, 255] : [...ACCENT, 255];
    raw.set(px, yy * (SIZE * 4 + 1) + 1 + xx * 4);
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
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(
  new URL("../src-tauri/app-icon.png", import.meta.url),
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
);
console.log("app-icon.png written");
