"use client";

import { del, get, set, createStore } from "idb-keyval";
import { config } from "./config";
import { api, supabase } from "./client";
import { outboxState, tickets } from "./shared/idb";
import { jobKey, sendJob, type QueuedJob, type SendOutcome } from "./shared/outbox-core";
import { accessToken } from "./shared/supabase";

const kv = createStore("partspilot", "kv");

export type GetTurnstileToken = () => Promise<string | null>;

/** Keeps a small pool of single-use upload tickets (each issued only after Turnstile). */
export async function refillTickets(getTurnstile: GetTurnstileToken): Promise<void> {
  const fresh = (await tickets.all()).filter((t) => Date.parse(t.expires_at) > Date.now() + 60 * 60 * 1000);
  if (fresh.length >= 2) return;
  const token = await getTurnstile();
  if (!token) return;
  const res = await api.uploadTickets(token);
  await tickets.replace(res.tickets);
}

/** Online send. Uses a ticket when we have one; otherwise a fresh Turnstile token. */
export async function sendNow(job: QueuedJob, getTurnstile: GetTurnstileToken): Promise<SendOutcome> {
  const deps = { apiUrl: config.apiUrl, getToken: () => accessToken(supabase()), takeTicket: tickets.take, timeoutMs: 15_000 };
  const first = await sendJob(job, deps);
  if (first.kind !== "no_ticket") return first;
  return sendJob(job, { ...deps, turnstileToken: await getTurnstile() });
}

/** Persists the job and hands it to the service worker's Background Sync queue. */
export async function enqueue(job: QueuedJob): Promise<void> {
  await set(jobKey(job.client_request_id), job, kv);
  await outboxState.addPending({ client_request_id: job.client_request_id, queued_at: job.queued_at, photo_count: job.photos.length });
  const sw = navigator.serviceWorker?.controller;
  if (sw) sw.postMessage({ type: "queued", id: job.client_request_id });
}

/**
 * Asks the service worker to retry now (also covers browsers without Background Sync,
 * e.g. iOS Safari). Without a controlling worker (first visit, dev), replays in the page.
 */
export async function requestReplay(getTurnstile: GetTurnstileToken): Promise<void> {
  const sw = navigator.serviceWorker?.controller;
  if (sw) {
    sw.postMessage({ type: "replay" });
    return;
  }
  for (const p of await outboxState.pending()) {
    const job = await get<QueuedJob>(jobKey(p.client_request_id), kv);
    if (!job) {
      await outboxState.removePending(p.client_request_id);
      continue;
    }
    const outcome = await sendNow(job, getTurnstile);
    if (outcome.kind === "sent" || outcome.kind === "failed") {
      await del(jobKey(p.client_request_id), kv);
      await outboxState.removePending(p.client_request_id);
      if (outcome.kind === "failed") await outboxState.addFailed({ client_request_id: p.client_request_id, code: outcome.code, at: new Date().toISOString() });
    } else {
      return;
    }
  }
}
