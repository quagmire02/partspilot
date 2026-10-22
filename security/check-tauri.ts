/** CI gate for desktop hardening. Usage: tsx check-tauri.ts [path/to/tauri.conf.json] */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditTauri } from "./lib/tauri.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const confPath = process.argv[2] ?? join(ROOT, "apps/desktop/src-tauri/tauri.conf.json");
if (!existsSync(confPath)) {
  console.error(`missing ${confPath}`);
  process.exit(1);
}
const capDir = join(dirname(confPath), "capabilities");
const caps = existsSync(capDir)
  ? readdirSync(capDir)
      .filter((f) => f.endsWith(".json"))
      .map((name) => ({ name, json: JSON.parse(readFileSync(join(capDir, name), "utf8")) }))
  : [];
const findings = auditTauri(JSON.parse(readFileSync(confPath, "utf8")), caps);
if (findings.length) {
  console.error("Tauri hardening check FAILED:");
  for (const f of findings) console.error(`  ${f.where}: ${f.problem}`);
  process.exit(1);
}
console.log(`Tauri hardening check passed (${caps.length} capability file(s)).`);
