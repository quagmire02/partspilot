// Production overlay for `tauri build`: CSP pinned to the real API + Supabase origins.
// Reads VITE_API_URL / VITE_SUPABASE_URL (same values the web bundle is built with).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("..", import.meta.url));
for (const f of [".env.production.local", ".env.production", ".env.local", ".env"]) {
  try {
    for (const line of readFileSync(`${APP}/${f}`, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // optional file
  }
}
const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`gen-config: set ${k}`);
  return new URL(v);
};
const api = need("VITE_API_URL");
const supa = need("VITE_SUPABASE_URL");
const ws = `${supa.protocol === "https:" ? "wss:" : "ws:"}//${supa.host}`;

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supa.origin}`,
  `connect-src 'self' ipc: http://ipc.localhost ${api.origin} ${supa.origin} ${ws}`,
  "font-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const pkg = JSON.parse(readFileSync(`${APP}/package.json`, "utf8"));
writeFileSync(`${APP}/src-tauri/tauri.generated.json`, JSON.stringify({ version: pkg.version, app: { security: { csp } } }, null, 2) + "\n");
console.log(`tauri.generated.json: CSP for ${api.origin} + ${supa.origin}`);
