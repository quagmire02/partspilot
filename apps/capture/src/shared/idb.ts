import { createStore, del, get, set, update } from "idb-keyval";

/**
 * One IndexedDB database shared by the page and the service worker:
 *  - the Supabase session (so the SW can refresh tokens for queued uploads)
 *  - the upload-ticket pool
 *  - pending/failed outbox bookkeeping for the UI
 */
const store = () => createStore("partspilot", "kv");
let cached: ReturnType<typeof createStore> | null = null;
const kv = () => (cached ??= store());

/** supabase-js storage adapter (async). */
export const idbStorage = {
  getItem: async (key: string) => ((await get<string>(key, kv())) ?? null),
  setItem: async (key: string, value: string) => set(key, value, kv()),
  removeItem: async (key: string) => del(key, kv()),
};

export interface Ticket {
  id: string;
  expires_at: string;
}

export interface PendingJob {
  client_request_id: string;
  queued_at: string;
  photo_count: number;
}

export interface FailedJob {
  client_request_id: string;
  code: string;
  at: string;
}

export const tickets = {
  all: async () => (await get<Ticket[]>("tickets", kv())) ?? [],
  replace: (t: Ticket[]) => set("tickets", t, kv()),
  /** Removes and returns a ticket valid for at least another minute. */
  take: async (): Promise<string | null> => {
    let taken: string | null = null;
    await update<Ticket[]>(
      "tickets",
      (list = []) => {
        const fresh = list.filter((t) => Date.parse(t.expires_at) > Date.now() + 60_000);
        taken = fresh.shift()?.id ?? null;
        return fresh;
      },
      kv(),
    );
    return taken;
  },
};

export const outboxState = {
  pending: async () => (await get<PendingJob[]>("pending", kv())) ?? [],
  addPending: (p: PendingJob) => update<PendingJob[]>("pending", (l = []) => [...l.filter((x) => x.client_request_id !== p.client_request_id), p], kv()),
  removePending: (id: string) => update<PendingJob[]>("pending", (l = []) => l.filter((x) => x.client_request_id !== id), kv()),
  failed: async () => (await get<FailedJob[]>("failed", kv())) ?? [],
  addFailed: (f: FailedJob) => update<FailedJob[]>("failed", (l = []) => [...l, f].slice(-10), kv()),
  clearFailed: () => set("failed", [], kv()),
};
