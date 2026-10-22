export interface TauriFinding {
  where: string;
  problem: string;
}

const FORBIDDEN_PERMISSION = /^(shell|fs|http|process|sql|updater|websocket|upload|stronghold|global-shortcut):/;

function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), values);
  }
  return out;
}

/** Desktop hardening rules: no shell/fs/http plugins, strict CSP, no remote IPC. */
export function auditTauri(conf: Record<string, unknown>, capabilities: { name: string; json: Record<string, unknown> }[]): TauriFinding[] {
  const out: TauriFinding[] = [];
  const app = (conf.app ?? {}) as Record<string, unknown>;
  const security = (app.security ?? {}) as Record<string, unknown>;

  if (app.withGlobalTauri === true) out.push({ where: "tauri.conf.json", problem: "withGlobalTauri must be false" });
  if ("dangerousRemoteDomainIpcAccess" in security) out.push({ where: "tauri.conf.json", problem: "remote IPC access enabled" });
  if (security.dangerousDisableAssetCspModification) out.push({ where: "tauri.conf.json", problem: "CSP modification disabled" });

  const csp = typeof security.csp === "string" ? security.csp : null;
  if (!csp) {
    out.push({ where: "tauri.conf.json", problem: "app.security.csp must be a strict policy string" });
  } else {
    const d = parseCsp(csp);
    const src = (name: string) => d.get(name) ?? d.get("default-src") ?? [];
    if (!(d.get("default-src") ?? []).includes("'self'")) out.push({ where: "csp", problem: "default-src must be 'self'" });
    for (const v of src("script-src")) {
      if (v !== "'self'" && !v.startsWith("'sha256-") && !v.startsWith("'nonce-")) out.push({ where: "csp", problem: `script-src allows ${v}` });
    }
    if (csp.includes("'unsafe-eval'")) out.push({ where: "csp", problem: "'unsafe-eval' is not allowed" });
    for (const v of src("connect-src")) {
      if (v === "*" || v === "https:" || v === "http:" || v === "wss:" || v.includes("*")) {
        out.push({ where: "csp", problem: `connect-src too broad: ${v}` });
      }
    }
    if (!(d.get("object-src") ?? []).includes("'none'")) out.push({ where: "csp", problem: "object-src must be 'none'" });
    const frames = d.get("frame-src") ?? d.get("child-src") ?? d.get("default-src") ?? [];
    if (frames.some((v) => v !== "'none'" && v !== "'self'")) out.push({ where: "csp", problem: "frames must be 'none'" });
  }

  for (const cap of capabilities) {
    const perms = (cap.json.permissions ?? []) as (string | { identifier: string })[];
    for (const p of perms) {
      const id = typeof p === "string" ? p : p.identifier;
      if (FORBIDDEN_PERMISSION.test(id)) out.push({ where: cap.name, problem: `forbidden permission ${id}` });
    }
    if (Array.isArray(cap.json.remote) || cap.json.remote) out.push({ where: cap.name, problem: "remote URLs must not get capabilities" });
  }
  return out;
}
