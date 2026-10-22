/**
 * CI gate: fails if any table lacks RLS. Two independent checks:
 *  1. static audit of supabase/migrations/*.sql
 *  2. live check: apply the migrations to an in-process Postgres (PGlite + pgvector)
 *     and query pg_class.relrowsecurity for every table in the public schema.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { auditMigrations, readMigrations } from "./lib/rls.js";

const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;

async function liveCheck(files: string[]): Promise<string[]> {
  const db = await PGlite.create({ extensions: { vector, pg_trgm } });
  await db.exec(STUB);
  for (const sql of files) await db.exec(sql);
  const r = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`,
  );
  const fnGrants = await db.query<{ proname: string }>(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
        and p.proname <> 'set_updated_at'`,
  );
  await db.close();
  return [
    ...r.rows.map((x) => `${x.relname}: RLS disabled (live)`),
    ...fnGrants.rows.map((x) => `${x.proname}(): executable by client roles (live)`),
  ];
}

const files = readMigrations(MIGRATIONS);
const problems = [
  ...auditMigrations(files).map((f) => `${f.table}: ${f.problem} (static)`),
  ...(await liveCheck(files)),
];
if (problems.length) {
  console.error(`RLS check FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`RLS check passed: ${files.length} migration file(s), every public table has RLS and owner policies.`);
