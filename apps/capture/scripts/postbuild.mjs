// After `next build` (static export to out/):
//  1. bundle the service worker with esbuild (public config inlined),
//  2. inject the Workbox precache manifest,
//  3. write out/_headers (Cloudflare Pages) with a strict CSP that whitelists Next's
//     inline bootstrap scripts by SHA-256 hash instead of allowing 'unsafe-inline'.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { injectManifest } from "workbox-build";

const APP = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(APP, "out");
const TMP = join(APP, ".sw-build");

// Same precedence as Next for production builds; real environment variables win (CI).
for (const f of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  let text = "";
  try {
    text = readFileSync(join(APP, f), "utf8");
  } catch {
    continue;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

const cfg = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
};
for (const [k, v] of Object.entries(cfg)) if (!v) throw new Error(`postbuild: missing public config ${k}`);

mkdirSync(TMP, { recursive: true });
await build({
  entryPoints: [join(APP, "src/sw/sw.ts")],
  outfile: join(TMP, "sw.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  define: {
    __PP_CONFIG__: JSON.stringify(cfg),
    "process.env.NODE_ENV": '"production"',
    // Safety net: nothing in the SW should read page config, but never leave a bare `process`.
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(cfg.supabaseUrl),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(cfg.supabaseAnonKey),
    "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(cfg.apiUrl),
    "process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY": '""',
  },
});

const { count, size, warnings } = await injectManifest({
  swSrc: join(TMP, "sw.js"),
  swDest: join(OUT, "sw.js"),
  globDirectory: OUT,
  globPatterns: ["**/*.{html,js,css,png,webmanifest,txt,woff2,svg,ico}"],
  globIgnores: ["sw.js", "_headers", "**/*.map"],
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  dontCacheBustURLsMatching: /\/_next\/static\//,
});
for (const w of warnings) console.warn(`workbox: ${w}`);

function* html(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* html(p);
    else if (p.endsWith(".html")) yield p;
  }
}
const hashes = new Set();
for (const file of html(OUT)) {
  for (const m of readFileSync(file, "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim()) hashes.add(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
  }
}
const origin = (u) => new URL(u).origin;
const supa = origin(cfg.supabaseUrl);
const csp = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com ${[...hashes].join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  `connect-src 'self' ${origin(cfg.apiUrl)} ${supa} https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  `form-action 'self' ${supa}`,
  "frame-ancestors 'none'",
].join("; ");
writeFileSync(
  join(OUT, "_headers"),
  [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "  Permissions-Policy: camera=(self), microphone=(), geolocation=()",
    "  Cross-Origin-Opener-Policy: same-origin",
    "/sw.js",
    "  Cache-Control: no-cache",
    "",
  ].join("\n"),
);
console.log(`postbuild: sw.js precaches ${count} files (${(size / 1024).toFixed(0)} KiB); CSP has ${hashes.size} inline-script hashes`);
