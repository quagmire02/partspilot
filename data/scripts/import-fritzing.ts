/**
 * Imports Fritzing core part metadata (titles, families, tags, connector names) into
 * data/generated/fritzing-core.json. Source: https://github.com/fritzing/fritzing-parts
 * License of the source data: CC-BY-SA 3.0 — the generated file inherits it (see LICENSES.md).
 *
 * Usage: pnpm --filter @partspilot/data import:fritzing [path/to/fritzing-parts]
 * Without a path it sparse-clones the repo into data/.cache/fritzing-parts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const DATA = fileURLToPath(new URL("..", import.meta.url));
const REPO = process.argv[2] ?? join(DATA, ".cache/fritzing-parts");

export interface FritzingPart {
  module_id: string;
  file: string;
  title: string;
  family: string | null;
  type: string | null;
  part_number: string | null;
  tags: string[];
  connectors: string[];
}

function ensureRepo(): string {
  if (existsSync(join(REPO, "core"))) return git(["rev-parse", "HEAD"], REPO).trim();
  mkdirSync(join(DATA, ".cache"), { recursive: true });
  git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/fritzing/fritzing-parts.git", REPO]);
  git(["sparse-checkout", "set", "--no-cone", "core/*.fzp", "LICENSE*"], REPO);
  return git(["rev-parse", "HEAD"], REPO).trim();
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "#text" in v) return String((v as { "#text": unknown })["#text"]).trim() || null;
  return null;
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });

export function parseFzp(xml: string, file: string): FritzingPart | null {
  const doc = parser.parse(xml) as { module?: Record<string, unknown> };
  const m = doc.module;
  if (!m) return null;
  const title = text(m.title);
  const moduleId = (m["@moduleId"] as string | undefined) ?? null;
  if (!title || !moduleId) return null;
  const props = asArray((m.properties as { property?: unknown } | undefined)?.property) as Record<string, unknown>[];
  const prop = (name: string) => {
    const p = props.find((x) => String(x["@name"] ?? "").toLowerCase() === name);
    return p ? text(p) : null;
  };
  const tags = asArray((m.tags as { tag?: unknown } | undefined)?.tag)
    .map(text)
    .filter((t): t is string => Boolean(t));
  const connectors = asArray((m.connectors as { connector?: unknown } | undefined)?.connector)
    .map((c) => String((c as Record<string, unknown>)["@name"] ?? "").trim())
    .filter(Boolean);
  return {
    module_id: moduleId,
    file,
    title: title.replace(/\s+/g, " "),
    family: prop("family"),
    type: prop("type"),
    part_number: prop("part number"),
    tags,
    connectors,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const commit = ensureRepo();
  const dir = join(REPO, "core");
  const parts: FritzingPart[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".fzp")).sort()) {
    try {
      const p = parseFzp(readFileSync(join(dir, f), "utf8"), f);
      if (p) parts.push(p);
    } catch {
      // malformed upstream file: skip
    }
  }
  mkdirSync(join(DATA, "generated"), { recursive: true });
  const out = {
    source: "https://github.com/fritzing/fritzing-parts",
    commit,
    license: "CC-BY-SA-3.0",
    attribution: "Fritzing parts library, © Friends-of-Fritzing e.V. and contributors",
    parts,
  };
  writeFileSync(join(DATA, "generated/fritzing-core.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`fritzing: ${parts.length} parts from ${commit.slice(0, 10)}`);
}
