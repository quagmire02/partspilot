import { describe, expect, it } from "vitest";
import { cleanImage, sniff } from "../src/lib/images.js";
import { heic, includes, jpeg, png, SECRET, webp } from "./support/images.js";

describe("image sanitizer", () => {
  it("sniffs by magic bytes, not by name or declared type", () => {
    expect(sniff(jpeg())).toBe("image/jpeg");
    expect(sniff(png())).toBe("image/png");
    expect(sniff(webp())).toBe("image/webp");
    expect(sniff(heic())).toBe("heic");
    expect(sniff(new TextEncoder().encode("<svg onload=alert(1)>"))).toBe("unknown");
  });

  it.each([
    ["jpeg", jpeg, "image/jpeg"],
    ["png", png, "image/png"],
    ["webp", webp, "image/webp"],
  ] as const)("strips metadata from %s and reads dimensions", async (_, make, mime) => {
    const input = make(1280, 960);
    expect(includes(input, SECRET)).toBe(true);
    const out = await cleanImage(input);
    expect(out.mime).toBe(mime);
    expect([out.width, out.height]).toEqual([1280, 960]);
    expect(includes(out.bytes, SECRET)).toBe(false);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps JFIF and image data and drops ICC/comments in JPEG", async () => {
    const out = await cleanImage(jpeg(800, 600));
    expect(includes(out.bytes, "JFIF")).toBe(true);
    expect(includes(out.bytes, "ICC_PROFILE")).toBe(false);
    expect(out.bytes.at(-2)).toBe(0xff);
    expect(out.bytes.at(-1)).toBe(0xd9);
  });

  it("clears the EXIF/XMP flags in the WebP VP8X header and fixes the RIFF size", async () => {
    const out = await cleanImage(webp(800, 600));
    const view = new DataView(out.bytes.buffer, out.bytes.byteOffset);
    expect(view.getUint32(4, true)).toBe(out.bytes.length - 8);
    expect(out.bytes[20]! & 0x0c).toBe(0);
  });

  it("produces identical hashes for identical cleaned content", async () => {
    const a = await cleanImage(jpeg(900, 700));
    const b = await cleanImage(jpeg(900, 700, { exif: false }));
    expect(a.sha256).toBe(b.sha256);
  });

  it.each([
    ["HEIC", heic(), "heic_not_converted"],
    ["random bytes", new Uint8Array(4096).fill(7), "unsupported_media_type"],
    ["truncated JPEG", jpeg().subarray(0, 60), "image_corrupt"],
    ["tiny photo", jpeg(320, 240), "image_too_small"],
    ["over 10 MB", jpeg(1024, 768, { padTo: 10 * 1024 * 1024 + 1 }), "payload_too_large"],
  ])("rejects %s", async (_, bytes, code) => {
    await expect(cleanImage(bytes)).rejects.toMatchObject({ code });
  });
});
