/**
 * CI gate: no secrets in the phone PWA or desktop bundles.
 * Usage: tsx check-bundles.ts [--strict] [dir ...]
 * Default dirs: apps/capture/out, apps/desktop/dist. --strict fails when a dir is missing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { scanText, type SecretFinding } from "./lib/secrets.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".html", ".json", ".css", ".map", ".txt", ".webmanifest", ".svg"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (TEXT_EXT.has(extname(p))) yield p;
  }
}

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const dirs = args.filter((a) => !a.startsWith("--"));
const targets = (dirs.length ? dirs : ["apps/capture/out", "apps/desktop/dist"]).map((d) => join(ROOT, d));

const findings: SecretFinding[] = [];
let scanned = 0;
for (const dir of targets) {
  if (!existsSync(dir)) {
    const msg = `bundle dir missing: ${relative(ROOT, dir)}`;
    if (strict) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(`${msg} (skipped)`);
    continue;
  }
  for (const file of walk(dir)) {
    scanned++;
    findings.push(...scanText(relative(ROOT, file), readFileSync(file, "utf8")));
  }
}
if (findings.length) {
  console.error("Bundle secret scan FAILED:");
  for (const f of findings) console.error(`  ${f.file}: ${f.kind} ${f.sample}`);
  process.exit(1);
}
console.log(`Bundle secret scan passed (${scanned} files).`);
