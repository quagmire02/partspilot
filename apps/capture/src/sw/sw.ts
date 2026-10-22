/// <reference lib="webworker" />
/**
 * PartsPilot capture service worker (bundled by scripts/postbuild.mjs, manifest injected by
 * workbox-build). Responsibilities: precache the app shell for offline use, and own the
 * offline upload queue via Workbox Background Sync.
 *
 * Queued jobs are NOT replayed as stored requests: JWTs and Turnstile tokens would be
 * stale. Each replay rebuilds the upload with a freshly refreshed session and a single-use
 * upload ticket (see docs/architecture.md, ADR-001).
 */
import { Queue } from "workbox-background-sync";
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { createStore, del, get } from "idb-keyval";
import { outboxState, tickets } from "../shared/idb";
import { jobKey, sendJob, type QueuedJob } from "../shared/outbox-core";
import { accessToken, createSupabase } from "../shared/supabase";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };
declare const __PP_CONFIG__: { supabaseUrl: string; supabaseAnonKey: string; apiUrl: string };

const cfg = __PP_CONFIG__;
const kv = createStore("partspilot", "kv");

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const sb = createSupabase(cfg.supabaseUrl, cfg.supabaseAnonKey, { autoRefresh: false });

async function broadcast(msg: Record<string, unknown>): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of clients) c.postMessage(msg);
}

let running: Promise<void> | null = null;

async function replayOnce(): Promise<void> {
  for (;;) {
    const entry = await queue.shiftRequest();
    if (!entry) return;
    const id = (entry.metadata as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string") continue;
    const job = await get<QueuedJob>(jobKey(id), kv);
    if (!job) continue;

    const outcome = await sendJob(job, { apiUrl: cfg.apiUrl, getToken: () => accessToken(sb), takeTicket: tickets.take, timeoutMs: 60_000 });
    if (outcome.kind === "sent") {
      await del(jobKey(id), kv);
      await outboxState.removePending(id);
      await broadcast({ type: "outbox-sent", id, job_id: outcome.job_id, quota: outcome.quota });
      continue;
    }
    if (outcome.kind === "failed") {
      await del(jobKey(id), kv);
      await outboxState.removePending(id);
      await outboxState.addFailed({ client_request_id: id, code: outcome.code, at: new Date().toISOString() });
      await broadcast({ type: "outbox-failed", id, code: outcome.code });
      continue;
    }
    await queue.unshiftRequest(entry);
    await broadcast({ type: "outbox-waiting", reason: outcome.kind, code: "code" in outcome ? outcome.code : null });
    // Throwing makes Workbox keep the sync registration and retry later (network/server busy).
    if (outcome.kind === "retry") throw new Error("retry_later");
    return; // signed out or no ticket: the open page will fix that and ask for a replay
  }
}

function replay(): Promise<void> {
  running ??= replayOnce().finally(() => (running = null));
  return running;
}

const queue = new Queue("pp-jobs", {
  maxRetentionTime: 7 * 24 * 60, // minutes
  onSync: () => replay(),
});

self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; id?: unknown } | null;
  if (data?.type === "queued" && typeof data.id === "string") {
    const id = data.id;
    event.waitUntil(
      queue
        .pushRequest({ request: new Request(`${cfg.apiUrl}/v1/jobs?outbox=${encodeURIComponent(id)}`, { method: "POST" }), metadata: { id } })
        .then(() => (self.navigator.onLine ? replay() : undefined))
        .catch(() => undefined),
    );
  } else if (data?.type === "replay") {
    event.waitUntil(replay().catch(() => undefined));
  }
});
