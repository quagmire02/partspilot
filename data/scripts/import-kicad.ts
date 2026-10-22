/**
 * Extracts pin names/numbers/electrical types for the KiCad symbols we cross-check our
 * curated profiles against. Source: https://gitlab.com/kicad/libraries/kicad-symbols
 * (CC-BY-SA 4.0 with the KiCad design exception — see LICENSES.md).
 *
 * Usage: pnpm --filter @partspilot/data import:kicad [path/to/kicad-symbols]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KICAD_REFS } from "../src/kicad-refs";

const DATA = fileURLToPath(new URL("..", import.meta.url));
const REPO = process.argv[2] ?? join(DATA, ".cache/kicad-symbols");

export interface KicadPin {
  name: string;
  number: string;
  type: string;
}

const git = (args: string[], cwd?: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

function ensureRepo(symbols: string[]): string {
  const patterns = symbols.map((s) => {
    const [lib, name] = s.split(":");
    return `${lib}.kicad_symdir/${name}.kicad_sym`;
  });
  if (!existsSync(REPO)) {
    mkdirSync(join(DATA, ".cache"), { recursive: true });
    git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", "https://gitlab.com/kicad/libraries/kicad-symbols.git", REPO]);
  }
  git(["sparse-checkout", "add", "--no-cone", ...patterns, "LICENSE.md"], REPO);
  return git(["rev-parse", "HEAD"], REPO).trim();
}

/** Minimal reader for the pins of one symbol file (KiCad 9+ one-symbol-per-file layout). */
export function parseKicadSymbol(src: string): { pins: KicadPin[]; extendsName: string | null } {
  const pins: KicadPin[] = [];
  const re = /\(pin\s+([a-z_]+)\s+[a-z_]+[\s\S]*?\(name\s+"([^"]*)"[\s\S]*?\(number\s+"([^"]*)"/g;
  for (const m of src.matchAll(re)) {
    pins.push({ type: m[1]!, name: m[2]!.replace(/~\{([^}]*)\}/g, "$1"), number: m[3]! });
  }
  const ext = /\(extends\s+"([^"]+)"\)/.exec(src);
  return { pins, extendsName: ext?.[1] ?? null };
}

function loadSymbol(lib: string, name: string, depth = 0): KicadPin[] {
  const file = join(REPO, `${lib}.kicad_symdir`, `${name}.kicad_sym`);
  if (!existsSync(file)) {
    if (depth === 0) throw new Error(`missing KiCad symbol ${lib}:${name}`);
    git(["sparse-checkout", "add", "--no-cone", `${lib}.kicad_symdir/${name}.kicad_sym`], REPO);
  }
  const { pins, extendsName } = parseKicadSymbol(readFileSync(file, "utf8"));
  if (pins.length === 0 && extendsName && depth < 3) return loadSymbol(lib, extendsName, depth + 1);
  return pins;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const refs = [...new Set(Object.values(KICAD_REFS))];
  const commit = ensureRepo(refs);
  const symbols: Record<string, KicadPin[]> = {};
  for (const ref of refs) {
    const [lib, name] = ref.split(":") as [string, string];
    symbols[ref] = loadSymbol(lib, name);
  }
  mkdirSync(join(DATA, "generated"), { recursive: true });
  writeFileSync(
    join(DATA, "generated/kicad-pins.json"),
    JSON.stringify(
      {
        source: "https://gitlab.com/kicad/libraries/kicad-symbols",
        commit,
        license: "CC-BY-SA-4.0 with KiCad libraries exception",
        symbols,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`kicad: ${refs.length} symbols from ${commit.slice(0, 10)}`);
}
