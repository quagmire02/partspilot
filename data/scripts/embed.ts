/**
 * Fills missing embeddings for catalog aliases and reference projects.
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… AI_PROVIDER=… (+ its settings) pnpm --filter @partspilot/data embed
 *   (`pnpm run setup` runs this for you with the settings from the root .env)
 *   … embed --mock     (deterministic hash embeddings for the local stack; no API key)
 *   … embed --all      (re-embed everything, e.g. after switching from --mock to Gemini)
 *   … embed --all --after=<id>   (resume an interrupted --all run)
 * Rate limits (Gemini free tier) are waited out; one batch request per page.
 */
import { createClient } from "@supabase/supabase-js";
import { hashEmbedding, ModelError, providerFromConfig, type ModelProvider } from "@partspilot/ai";

const PAGE = 100;
const MAX_ATTEMPTS = 8;

const mock = process.argv.includes("--mock");
const all = process.argv.includes("--all");
const after = Number(process.argv.find((a) => a.startsWith("--after="))?.slice(8) ?? 0);
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const provider: Pick<ModelProvider, "embed"> = mock
  ? { embed: async (texts) => texts.map(hashEmbedding) }
  : providerFromConfig(process.env);

async function embed(texts: string[]): Promise<number[][]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await provider.embed(texts, "document");
    } catch (e) {
      if (!(e instanceof ModelError && e.retryable) || attempt >= MAX_ATTEMPTS) throw e;
      const wait = Math.min(60, 5 * 2 ** (attempt - 1));
      process.stdout.write(`\n${e.message}; retrying in ${wait}s\n`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

let lastId = after;

async function embedAliases(): Promise<number> {
  let done = 0;
  for (;;) {
    let q = sb.from("catalog_aliases").select("id, alias, catalog_parts(name)").order("id").limit(PAGE);
    q = all ? q.gt("id", lastId) : q.is("embedding", null);
    const { data, error } = await q;
    if (error) throw new Error(`select aliases: ${error.code}`);
    const rows = data as unknown as { id: number; alias: string; catalog_parts: { name: string } | null }[];
    if (!rows.length) return done;
    const texts = rows.map((r) => (r.catalog_parts?.name && r.catalog_parts.name !== r.alias ? `${r.alias} (${r.catalog_parts.name})` : r.alias));
    const vectors = await embed(texts);
    const payload = rows.map((r, i) => ({ id: r.id, embedding: JSON.stringify(vectors[i]) }));
    const { error: upErr } = await sb.rpc("set_alias_embeddings", { p_rows: payload });
    if (upErr) throw new Error(`write aliases: ${upErr.code}`);
    done += rows.length;
    lastId = rows.at(-1)!.id;
    process.stdout.write(`aliases: ${done}\r`);
  }
}

async function embedReferences(): Promise<number> {
  let q = sb.from("reference_projects").select("id, title, goal_examples");
  if (!all) q = q.is("embedding", null);
  const { data, error } = await q;
  if (error) throw new Error(`select references: ${error.code}`);
  const rows = data as { id: string; title: string; goal_examples: string[] }[];
  if (!rows.length) return 0;
  const vectors = await embed(rows.map((r) => [r.title, ...r.goal_examples].join(". ")));
  const { error: upErr } = await sb.rpc("set_reference_embeddings", {
    p_rows: rows.map((r, i) => ({ id: r.id, embedding: JSON.stringify(vectors[i]) })),
  });
  if (upErr) throw new Error(`write references: ${upErr.code}`);
  return rows.length;
}

try {
  const a = await embedAliases();
  const r = await embedReferences();
  console.log(`\nembedded ${a} aliases and ${r} reference projects (${mock ? "mock" : "gemini"})`);
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : "failed"}${all ? ` — resume with: embed --all --after=${lastId}` : " — rerun to continue"}`);
  process.exit(1);
}
