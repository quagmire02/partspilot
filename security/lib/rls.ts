import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RlsFinding {
  table: string;
  problem: "rls_not_enabled" | "no_policy" | "user_table_without_uid_policy" | "write_policy_for_clients";
}

const strip = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (name: string) => name.replace(/"/g, "").replace(/^public\./, "").toLowerCase();

/**
 * Static gate over migration SQL: every public table must enable RLS and have a policy;
 * tables with a user_id column need a policy bound to auth.uid(); clients get no
 * INSERT/UPDATE/DELETE/ALL policies (all writes go through the Worker).
 */
export function auditMigrations(sqlFiles: string[]): RlsFinding[] {
  const sql = strip(sqlFiles.join("\n;\n"));
  const tables = new Map<string, { hasUserId: boolean }>();
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s*\(([\s\S]*?)\n\);/gi)) {
    const schemaQualified = m[1]!;
    if (/^[a-z_]+\./i.test(schemaQualified) && !/^public\./i.test(schemaQualified)) continue;
    tables.set(norm(schemaQualified), { hasUserId: /\buser_id\s+uuid\b/i.test(m[2]!) });
  }
  const enabled = new Set(
    [...sql.matchAll(/alter\s+table\s+(?:only\s+)?([a-z0-9_."]+)\s+enable\s+row\s+level\s+security/gi)].map((m) => norm(m[1]!)),
  );
  const policies = [...sql.matchAll(/create\s+policy\s+\S+\s+on\s+([a-z0-9_."]+)([\s\S]*?);/gi)].map((m) => ({
    table: norm(m[1]!),
    body: m[2]!.toLowerCase(),
  }));

  const findings: RlsFinding[] = [];
  for (const [table, info] of tables) {
    if (!enabled.has(table)) findings.push({ table, problem: "rls_not_enabled" });
    const own = policies.filter((p) => p.table === table);
    if (own.length === 0) findings.push({ table, problem: "no_policy" });
    if (info.hasUserId && !own.some((p) => /user_id\s*=\s*\(?\s*(select\s+)?auth\.uid\(\)/.test(p.body))) {
      findings.push({ table, problem: "user_table_without_uid_policy" });
    }
    if (own.some((p) => /\bfor\s+(insert|update|delete|all)\b/.test(p.body) && /\bto\s+(anon|authenticated|public)\b/.test(p.body))) {
      findings.push({ table, problem: "write_policy_for_clients" });
    }
  }
  return findings;
}

export function readMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}
