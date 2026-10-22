#!/usr/bin/env node
/**
 * Run PartsPilot on your own computer.
 *   pnpm run setup   local database (Docker) + config files + parts catalog for your AI
 *   pnpm start       database + API + app, then opens http://localhost:1420
 *   pnpm run stop    stops the local database (your data is kept)
 * Settings live in the root .env (see .env.example).
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => join(root, ...s);
const isWin = process.platform === "win32";
const APP_URL = "http://localhost:1420";
const API_URL = "http://127.0.0.1:8787";

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
function run(command, { capture = false, env = {} } = {}) {
  return spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}
const readEnv = (file) => (existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {});

// --- settings ------------------------------------------------------------------------

function userConfig() {
  if (!existsSync(p(".env"))) {
    copyFileSync(p(".env.example"), p(".env"));
    console.log("Created .env from .env.example (AI_PROVIDER=ollama). Edit it to use another AI.");
  }
  return readEnv(p(".env"));
}

/** Translates the friendly root .env into the API server's settings. */
function aiSettings(u) {
  const provider = (u.AI_PROVIDER || "ollama").trim().toLowerCase();
  const timeout = u.AI_TIMEOUT_MS || "600000";
  const need = (vals, names) => {
    const gap = names.filter((n) => !vals[n]);
    if (gap.length) die(`AI_PROVIDER=${provider} needs ${gap.join(", ")} in .env`);
    return vals;
  };
  switch (provider) {
    case "ollama":
      return {
        AI_PROVIDER: "openai",
        OPENAI_BASE_URL: u.OLLAMA_URL || "http://127.0.0.1:11434/v1",
        OPENAI_MODEL: u.OLLAMA_MODEL || "qwen2.5vl:7b",
        OPENAI_EMBED_MODEL: u.OLLAMA_EMBED_MODEL || "nomic-embed-text",
        AI_TIMEOUT_MS: timeout,
        ollama: true,
      };
    case "openai":
      return need(
        {
          AI_PROVIDER: "openai",
          OPENAI_BASE_URL: u.OPENAI_BASE_URL,
          OPENAI_API_KEY: u.OPENAI_API_KEY,
          OPENAI_MODEL: u.OPENAI_MODEL,
          OPENAI_EMBED_MODEL: u.OPENAI_EMBED_MODEL,
          EMBED_BASE_URL: u.EMBED_BASE_URL,
          EMBED_API_KEY: u.EMBED_API_KEY,
          AI_TIMEOUT_MS: timeout,
        },
        ["OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_EMBED_MODEL"],
      );
    case "gemini":
      return need(
        { AI_PROVIDER: "gemini", GEMINI_API_KEY: u.GEMINI_API_KEY, GEMINI_MODEL: u.GEMINI_MODEL, GEMINI_EMBED_MODEL: u.GEMINI_EMBED_MODEL, AI_TIMEOUT_MS: timeout },
        ["GEMINI_API_KEY"],
      );
    case "mock":
      return { AI_PROVIDER: "mock" };
    default:
      return die(`AI_PROVIDER=${provider} in .env must be ollama, openai, gemini or mock`);
  }
}
const serverVars = ({ ollama: _ollama, ...vars }) => vars;

async function checkOllama(ai) {
  const base = ai.OPENAI_BASE_URL.replace(/\/v1\/?$/, "");
  let tags;
  try {
    tags = await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })).json();
  } catch {
    die(`Ollama is not reachable at ${base}. Install it from https://ollama.com and make sure it is running.`);
  }
  const have = new Set((tags.models ?? []).flatMap((m) => [m.name, m.name.replace(/:latest$/, "")]));
  const missing = [ai.OPENAI_MODEL, ai.OPENAI_EMBED_MODEL].filter((m) => !have.has(m) && !have.has(m.replace(/:latest$/, "")));
  if (missing.length) die(`Download the AI models first:\n  ${missing.map((m) => `ollama pull ${m}`).join("\n  ")}`);
}

// --- local database (Supabase in Docker) ---------------------------------------------

/** Google sign-in only when supabase/.env has a real OAuth client; otherwise email + password. */
function google() {
  const s = readEnv(p("supabase", ".env"));
  const configured = Boolean(s.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID && s.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET);
  const env = configured ? {} : { SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: "not-configured", SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: "not-configured" };
  return { configured, env };
}
const supabase = (args, opts) => run(`pnpm --silent --filter @partspilot/api exec supabase ${args} --workdir ../..`, opts);

function stackStatus(env) {
  const r = supabase("status -o env", { capture: true, env });
  if (r.status !== 0) return null;
  const s = parseEnv(r.stdout ?? "");
  return s.API_URL && s.SERVICE_ROLE_KEY && s.ANON_KEY ? s : null;
}

function ensureStack(g) {
  const ready = stackStatus(g.env);
  if (ready) return ready;
  if (run("docker info", { capture: true }).status !== 0) die("Docker is not running. Start Docker Desktop and try again.");
  console.log("Starting the local database (the first run downloads Docker images and can take a few minutes)…");
  const r = supabase("start -x imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit", { env: g.env });
  if (r.status !== 0) die("Could not start the local database (supabase start). See the output above.");
  return stackStatus(g.env) ?? die("The local database started but its status could not be read.");
}

function writeLocalConfig(s, ai, g) {
  const header = "# Generated by scripts/local.mjs from the root .env. Edit .env instead; never commit.\n";
  const lines = (o) => header + Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(
    p("apps/api/.dev.vars"),
    lines({ SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET: s.JWT_SECRET, TURNSTILE_SECRET: "off", ...serverVars(ai) }),
  );
  writeFileSync(
    p("apps/desktop/.env.local"),
    lines({ VITE_SUPABASE_URL: s.API_URL, VITE_SUPABASE_ANON_KEY: s.ANON_KEY, VITE_API_URL: API_URL }),
  );
  writeFileSync(
    p("apps/capture/.env.local"),
    lines({
      NEXT_PUBLIC_SUPABASE_URL: s.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: s.ANON_KEY,
      NEXT_PUBLIC_API_URL: API_URL,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      NEXT_PUBLIC_GOOGLE_SIGNIN: g.configured ? "1" : "",
    }),
  );
}

/** The catalog search needs embeddings from the same model that embeds detected labels. */
function embedCatalog(s, ai) {
  const marker = p("supabase", ".temp", "partspilot-embeddings");
  const want = [ai.AI_PROVIDER, ai.OPENAI_BASE_URL, ai.OPENAI_EMBED_MODEL, ai.GEMINI_EMBED_MODEL, ai.EMBED_BASE_URL].join("|");
  const have = existsSync(marker) ? readFileSync(marker, "utf8") : "";
  const flags = [ai.AI_PROVIDER === "mock" ? "--mock" : "", have === want ? "" : "--all"].filter(Boolean).join(" ");
  if (have !== want) console.log("Preparing the parts catalog for your AI (about 4,400 part names; a few minutes)…");
  const r = run(`pnpm --silent --filter @partspilot/data exec tsx scripts/embed.ts ${flags}`, {
    env: { SUPABASE_URL: s.API_URL, SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY, ...serverVars(ai) },
  });
  if (r.status !== 0) die("Preparing the parts catalog failed. Check your AI settings in .env, then run `pnpm run setup` again.");
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, want);
}

async function prepare() {
  const ai = aiSettings(userConfig());
  if (ai.ollama) await checkOllama(ai);
  const g = google();
  const s = ensureStack(g);
  writeLocalConfig(s, ai, g);
  embedCatalog(s, ai);
  return ai;
}

// --- start ---------------------------------------------------------------------------

const children = [];
function launch(name, command) {
  const child = spawn(command, { cwd: root, shell: true, stdio: ["ignore", "pipe", "pipe"], detached: !isWin });
  const tag = `[${name}] `;
  const pipe = (from, to) => from.on("data", (d) => to.write(String(d).replace(/^(?=.)/gm, tag)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => code && !stopping && console.error(`${tag}exited with code ${code}`));
  children.push(child);
}
let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      if (isWin) spawnSync(`taskkill /pid ${c.pid} /T /F`, { shell: true, stdio: "ignore" });
      else process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
  process.exit(0);
}

async function waitFor(url, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function start() {
  const ai = await prepare();
  process.on("SIGINT", stopAll);
  process.on("SIGTERM", stopAll);
  launch("api", "pnpm --silent --filter @partspilot/api dev:local");
  launch("app", "pnpm --silent --filter @partspilot/desktop dev");
  if (!(await waitFor(API_URL)) || !(await waitFor(APP_URL))) {
    console.error("\n✖ The API or the app did not start; see the output above.");
    return stopAll();
  }
  const label = ai.AI_PROVIDER === "mock" ? "mock (canned answers, ignores photos)" : ai.ollama ? `Ollama ${ai.OPENAI_MODEL}` : `${ai.AI_PROVIDER} ${ai.OPENAI_MODEL ?? ai.GEMINI_MODEL ?? ""}`;
  console.log(`\n✔ PartsPilot is running → ${APP_URL}   (AI: ${label})\n  Press Ctrl+C to stop.\n`);
  if (!process.env.CI) spawn(isWin ? `start "" "${APP_URL}"` : process.platform === "darwin" ? `open ${APP_URL}` : `xdg-open ${APP_URL}`, { shell: true, stdio: "ignore", detached: true }).unref();
}

const cmd = process.argv[2];
if (cmd === "setup") {
  await prepare();
  console.log("\n✔ Setup complete. Run `pnpm start` to open PartsPilot.\n");
} else if (cmd === "start") {
  await start();
} else if (cmd === "stop") {
  const r = supabase("stop", { env: google().env });
  process.exit(r.status ?? 1);
} else {
  die("usage: node scripts/local.mjs setup | start | stop");
}
