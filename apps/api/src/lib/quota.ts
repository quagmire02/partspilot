import { LIMITS, type Quota } from "@partspilot/shared";

export function quotaFor(used: number, now: Date): Quota {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const capped = Math.min(Math.max(used, 0), LIMITS.DAILY_JOBS);
  return {
    limit: LIMITS.DAILY_JOBS,
    used: capped,
    remaining: LIMITS.DAILY_JOBS - capped,
    resets_at: reset.toISOString(),
  };
}

export function secondsUntil(iso: string, now: Date): number {
  return Math.max(1, Math.ceil((Date.parse(iso) - now.getTime()) / 1000));
}
