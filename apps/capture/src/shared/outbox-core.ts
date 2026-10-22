import { buildCreateJobForm, type Quota } from "@partspilot/shared";

/** A job waiting to be sent. Blobs live in IndexedDB until the server accepts the job. */
export interface QueuedJob {
  client_request_id: string;
  goal: string;
  photos: Blob[];
  queued_at: string;
}

export type SendOutcome =
  | { kind: "sent"; job_id: string; quota: Quota | null; duplicate: boolean }
  | { kind: "retry"; code: string } // network / server busy: keep queued
  | { kind: "auth" } // signed out or refresh failed
  | { kind: "no_ticket" } // needs a fresh Turnstile token
  | { kind: "failed"; code: string }; // permanent (quota, bad photo, …)

export interface SendDeps {
  apiUrl: string;
  getToken: () => Promise<string | null>;
  takeTicket: () => Promise<string | null>;
  /** Fresh Turnstile response; used only when no ticket is available. */
  turnstileToken?: string | null;
  /** Abort a hanging upload (lie-fi) and queue it instead. Safe: replays are idempotent. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Sends one job. Idempotent thanks to client_request_id: replays after a lost response
 * come back as `duplicate` instead of creating a second job or spending quota.
 */
export async function sendJob(job: QueuedJob, deps: SendDeps): Promise<SendOutcome> {
  const doFetch = deps.fetch ?? ((i, init) => fetch(i, init));
  const token = await deps.getToken().catch(() => null);
  if (!token) return { kind: "auth" };

  for (let attempt = 0; attempt < 3; attempt++) {
    const ticket = await deps.takeTicket();
    const turnstile = ticket ? null : (deps.turnstileToken ?? null);
    if (!ticket && !turnstile) return { kind: "no_ticket" };
    const form = buildCreateJobForm({
      clientRequestId: job.client_request_id,
      goal: job.goal,
      photos: job.photos,
      uploadTicket: ticket ?? undefined,
      turnstileToken: turnstile ?? undefined,
    });
    let res: Response;
    const ctrl = new AbortController();
    const timer = deps.timeoutMs ? setTimeout(() => ctrl.abort(), deps.timeoutMs) : null;
    try {
      res = await doFetch(`${deps.apiUrl.replace(/\/+$/, "")}/v1/jobs`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
        signal: ctrl.signal,
      });
    } catch (e) {
      return { kind: "retry", code: ctrl.signal.aborted ? "timeout" : `network:${e instanceof Error ? e.name : "unknown"}` };
    } finally {
      if (timer) clearTimeout(timer);
    }
    const body = (await res.json().catch(() => null)) as
      | { job_id?: string; quota?: Quota; duplicate?: boolean; error?: { code?: string } }
      | null;
    if (res.status === 202 && body?.job_id) {
      return { kind: "sent", job_id: body.job_id, quota: body.quota ?? null, duplicate: Boolean(body.duplicate) };
    }
    const code = body?.error?.code ?? `http_${res.status}`;
    if (res.status === 401) return { kind: "auth" };
    if (code === "ticket_invalid") continue; // used/expired ticket: try the next one
    if (code === "turnstile_failed") return { kind: "no_ticket" };
    if (code === "rate_limited" || res.status >= 500) return { kind: "retry", code };
    return { kind: "failed", code };
  }
  return { kind: "no_ticket" };
}

export const jobKey = (id: string) => `job:${id}`;
