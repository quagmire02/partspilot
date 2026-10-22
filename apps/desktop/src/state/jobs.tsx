import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JobListItem, JobStatus } from "@partspilot/shared";
import { api, supabase } from "../auth";
import { catchUp, transitions } from "../notices";
import { platform } from "../platform";

const LAST_SYNC = "pp-last-sync";
export const NOTIFY_PREF = "pp-notifications";

interface JobsState {
  jobs: JobListItem[];
  loading: boolean;
  error: string | null;
  /** bumps whenever any job row changes (detail views refetch on it) */
  version: number;
  refresh: () => Promise<void>;
}

const Ctx = createContext<JobsState | null>(null);

export const notificationsEnabled = () => localStorage.getItem(NOTIFY_PREF) !== "off";

export function JobsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const statuses = useRef<Map<string, JobStatus>>(new Map());
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback(async (list: { title: string; body: string }[]) => {
    if (!notificationsEnabled()) return;
    for (const n of list) await platform().notify(n.title, n.body).catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { items } = await api.listJobs({ limit: 100 });
      if (first.current) {
        first.current = false;
        const since = localStorage.getItem(LAST_SYNC);
        if (since) await notify(catchUp(items.filter((j) => j.updated_at > since)));
      } else {
        await notify(transitions(statuses.current, items));
      }
      statuses.current = new Map(items.map((j) => [j.id, j.status]));
      const newest = items.reduce((m, j) => (j.updated_at > m ? j.updated_at : m), localStorage.getItem(LAST_SYNC) ?? "");
      if (newest) localStorage.setItem(LAST_SYNC, newest);
      setJobs(items);
      setError(null);
    } catch {
      setError("Can't reach PartsPilot right now. Retrying…");
    } finally {
      setLoading(false);
      setVersion((v) => v + 1);
    }
  }, [notify]);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 300);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const channel = supabase()
      .channel(`jobs:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .subscribe((status) => {
        // After a reconnect, re-sync in case events were missed while offline.
        if (status === "SUBSCRIBED") scheduleRefresh();
      });
    const poll = setInterval(() => void refresh(), 60_000); // safety net if Realtime drops silently
    return () => {
      void supabase().removeChannel(channel);
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [userId, refresh, scheduleRefresh]);

  const value = useMemo(() => ({ jobs, loading, error, version, refresh }), [jobs, loading, error, version, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJobs(): JobsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useJobs outside JobsProvider");
  return v;
}
