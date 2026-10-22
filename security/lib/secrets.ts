export interface SecretFinding {
  file: string;
  kind: string;
  sample: string;
}

const NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  "TURNSTILE_SECRET",
  "GEMINI_API_KEY",
  "service_role_key",
];

const PATTERNS: [string, RegExp][] = [
  ["supabase_secret_key", /\bsb_secret_[A-Za-z0-9_-]{10,}/g],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ["turnstile_test_secret", /\b[123]x0{31}AA\b/g],
  ["local_jwt_secret", /super-secret-jwt-token-with-at-least-32-characters-long/g],
];

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function decodeSegment(seg: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const mask = (s: string) => (s.length <= 12 ? s : `${s.slice(0, 8)}…(${s.length})`);

/**
 * Scans built client bundles. Allowed: Supabase URL, anon/publishable key, Turnstile site
 * key. Anything server-side (service role JWT, secret keys, env var names) fails.
 */
export function scanText(file: string, text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const name of NAMES) if (text.includes(name)) out.push({ file, kind: `server_env_name:${name}`, sample: name });
  for (const [kind, re] of PATTERNS) for (const m of text.matchAll(re)) out.push({ file, kind, sample: mask(m[0]) });
  for (const m of text.matchAll(JWT)) {
    const payload = decodeSegment(m[1]!);
    if (payload && payload.role !== "anon") out.push({ file, kind: `jwt_role:${String(payload.role)}`, sample: mask(m[0]) });
  }
  return out;
}
