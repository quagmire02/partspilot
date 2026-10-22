/**
 * Structured logger restricted to ids, timings and codes. Anything else is dropped,
 * so goals, labels, model output, URLs and tokens can never reach the logs.
 */
type Field = "job_id" | "user_id" | "ms" | "code" | "stage" | "status" | "n" | "attempt" | "plan_version" | "route";
export type LogFields = Partial<Record<Field, string | number>>;

const ALLOWED = new Set<string>(["job_id", "user_id", "ms", "code", "stage", "status", "n", "attempt", "plan_version", "route"]);
const SAFE_STRING = /^[A-Za-z0-9_\-:./{}]{1,80}$/;

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    else if (typeof v === "string" && SAFE_STRING.test(v)) out[k] = v;
  }
  return out;
}

export function log(event: string, fields: LogFields = {}): void {
  if (!/^[a-z0-9_.]{1,48}$/.test(event)) return;
  console.log(JSON.stringify({ event, ...sanitizeLogFields(fields) }));
}

export function timer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
