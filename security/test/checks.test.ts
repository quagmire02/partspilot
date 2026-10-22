import { describe, expect, it } from "vitest";
import { auditMigrations } from "../lib/rls.js";
import { scanText } from "../lib/secrets.js";
import { auditTauri } from "../lib/tauri.js";

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2lnbmF0dXJlc2lnbmF0dXJl`;

describe("RLS audit", () => {
  it("flags tables without RLS, without policies, or with client write policies", () => {
    const sql = `
      create table public.good (id int, user_id uuid not null
);
      alter table public.good enable row level security;
      create policy p on public.good for select to authenticated using (user_id = (select auth.uid()));
      create table public.no_rls (id int
);
      create table public.leaky (id int, user_id uuid
);
      alter table public.leaky enable row level security;
      create policy p on public.leaky for all to authenticated using (true);
      create table auth.other (id int
);
    `;
    const findings = auditMigrations([sql]);
    expect(findings).toEqual(
      expect.arrayContaining([
        { table: "no_rls", problem: "rls_not_enabled" },
        { table: "no_rls", problem: "no_policy" },
        { table: "leaky", problem: "user_table_without_uid_policy" },
        { table: "leaky", problem: "write_policy_for_clients" },
      ]),
    );
    expect(findings.some((f) => f.table === "good" || f.table === "other")).toBe(false);
  });
});

describe("bundle secret scan", () => {
  it("allows the anon key and flags service-role material", () => {
    expect(scanText("a.js", `const k="${jwt({ role: "anon", iss: "supabase" })}"`)).toEqual([]);
    const bad = scanText(
      "b.js",
      `${jwt({ role: "service_role" })} AIza${"x".repeat(35)} sb_secret_abcdefghijkl process.env.SUPABASE_SERVICE_ROLE_KEY 1x0000000000000000000000000000000AA`,
    );
    expect(bad.map((f) => f.kind)).toEqual(
      expect.arrayContaining([
        "jwt_role:service_role",
        "google_api_key",
        "supabase_secret_key",
        "server_env_name:SUPABASE_SERVICE_ROLE_KEY",
        "turnstile_test_secret",
      ]),
    );
    expect(bad.every((f) => !f.sample.includes("abcdefghijkl"))).toBe(true);
  });
});

describe("tauri audit", () => {
  const strict =
    "default-src 'self'; script-src 'self'; connect-src 'self' https://api.partspilot.app https://x.supabase.co wss://x.supabase.co; img-src 'self' data: https://x.supabase.co; object-src 'none'; frame-src 'none'";
  it("passes a hardened config", () => {
    expect(
      auditTauri({ app: { security: { csp: strict } } }, [
        { name: "default.json", json: { permissions: ["core:default", "deep-link:default", "notification:default"] } },
      ]),
    ).toEqual([]);
  });

  it("flags shell access, loose CSP and remote capabilities", () => {
    const f = auditTauri(
      { app: { withGlobalTauri: true, security: { csp: "default-src *; script-src 'self' 'unsafe-eval' https://cdn.example; connect-src *" } } },
      [{ name: "default.json", json: { permissions: ["shell:allow-execute", "fs:default"], remote: { urls: ["https://x"] } } }],
    );
    const problems = f.map((x) => x.problem).join("|");
    for (const p of ["withGlobalTauri", "unsafe-eval", "script-src allows https://cdn.example", "connect-src too broad: *", "shell:allow-execute", "fs:default", "remote URLs", "object-src"]) {
      expect(problems).toContain(p);
    }
  });
});
