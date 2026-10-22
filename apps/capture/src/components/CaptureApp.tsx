"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import type { Session } from "@supabase/supabase-js";
import { ApiRequestError, ERROR_USER_TEXT, isLocalStack, LIMITS, type ErrorCode, type Quota } from "@partspilot/shared";
import { config } from "../config";
import { api, supabase } from "../client";
import { normalizePhoto, PhotoError, type Photo } from "../images";
import { enqueue, refillTickets, requestReplay, sendNow } from "../outbox";
import { outboxState } from "../shared/idb";
import type { QueuedJob } from "../shared/outbox-core";
import { Camera } from "./Camera";
import { DevSignIn } from "./DevSignIn";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "queued" }
  | { kind: "error"; text: string };

const PHOTO_ERRORS: Record<string, string> = {
  too_small: "That photo is too small to read. Use the camera or a larger image.",
  unreadable: "That file isn't a photo we can read.",
};

function messageFor(code: string): string {
  return ERROR_USER_TEXT[code as ErrorCode] ?? (code === "quota_exceeded" ? ERROR_USER_TEXT.quota_exceeded! : "Couldn't send. Try again.");
}

export function CaptureApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [quota, setQuota] = useState<Quota | null>(null);
  const [pending, setPending] = useState(0);
  const [busyPhotos, setBusyPhotos] = useState(0);
  const turnstile = useRef<TurnstileInstance | undefined>(undefined);

  const getTurnstile = useCallback(async () => {
    const t = turnstile.current;
    if (!t) return null;
    try {
      t.reset();
      t.execute();
      return await t.getResponsePromise(20_000);
    } catch {
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setPending((await outboxState.pending()).length);
    try {
      setQuota(await api.quota());
    } catch {
      // offline or signed out: keep the last value
    }
  }, []);

  // --- session --------------------------------------------------------------------
  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- service worker + outbox ---------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; reason?: string; code?: string };
      if (msg?.type === "outbox-sent") {
        void refresh();
        // The queued job just went out: replace "Queued…" with the normal confirmation.
        setStatus((s) => (s.kind === "queued" ? { kind: "sent" } : s));
      }
      if (msg?.type === "outbox-failed") {
        void refresh();
        setStatus({ kind: "error", text: messageFor(msg.code ?? "") });
      }
      if (msg?.type === "outbox-waiting" && msg.reason === "no_ticket") {
        void refillTickets(getTurnstile).then(() => requestReplay(getTurnstile));
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const onOnline = () => void requestReplay(getTurnstile).then(refresh);
    window.addEventListener("online", onOnline);
    void refresh();
    void requestReplay(getTurnstile).catch(() => undefined);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
    };
  }, [session, refresh, getTurnstile]);

  // --- photos ----------------------------------------------------------------------
  const addPhotos = useCallback(async (blobs: Blob[]) => {
    const room = LIMITS.MAX_PHOTOS - photos.length - busyPhotos;
    const take = blobs.slice(0, Math.max(0, room));
    if (blobs.length > take.length) setStatus({ kind: "error", text: `Up to ${LIMITS.MAX_PHOTOS} photos per scan.` });
    setBusyPhotos((n) => n + take.length);
    for (const b of take) {
      try {
        const p = await normalizePhoto(b);
        setPhotos((list) => (list.length < LIMITS.MAX_PHOTOS ? [...list, p] : list));
        if (status.kind !== "idle") setStatus({ kind: "idle" });
      } catch (e) {
        setStatus({ kind: "error", text: PHOTO_ERRORS[e instanceof PhotoError ? e.code : "unreadable"]! });
      } finally {
        setBusyPhotos((n) => n - 1);
      }
    }
  }, [photos.length, busyPhotos, status.kind]);

  const removePhoto = (id: string) =>
    setPhotos((list) => {
      const p = list.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return list.filter((x) => x.id !== id);
    });

  // --- send ------------------------------------------------------------------------
  const send = async () => {
    if (!photos.length || status.kind === "sending") return;
    const job: QueuedJob = {
      client_request_id: crypto.randomUUID(),
      goal: goal.trim(),
      photos: photos.map((p) => p.blob),
      queued_at: new Date().toISOString(),
    };
    const reset = () => {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setGoal("");
    };
    if (!navigator.onLine) {
      await enqueue(job);
      reset();
      setStatus({ kind: "queued" });
      return void refresh();
    }
    setStatus({ kind: "sending" });
    const outcome = await sendNow(job, getTurnstile);
    if (outcome.kind === "sent") {
      reset();
      setStatus({ kind: "sent" });
      if (outcome.quota) setQuota(outcome.quota);
      void refillTickets(getTurnstile).catch(() => undefined);
    } else if (outcome.kind === "retry") {
      await enqueue(job);
      reset();
      setStatus({ kind: "queued" });
      void refresh();
    } else if (outcome.kind === "auth") {
      setStatus({ kind: "error", text: "Please sign in again." });
      await supabase().auth.signOut({ scope: "local" });
    } else if (outcome.kind === "no_ticket") {
      setStatus({ kind: "error", text: "Verification failed. Please try again." });
    } else {
      setStatus({ kind: "error", text: messageFor(outcome.code) });
    }
  };

  // Warm the ticket pool so the first Send doesn't wait for Turnstile.
  const onTurnstileReady = useCallback(() => {
    if (session) void refillTickets(getTurnstile).catch((e: unknown) => {
      if (e instanceof ApiRequestError && e.code === "unauthorized") void supabase().auth.signOut({ scope: "local" });
    });
  }, [session, getTurnstile]);

  // --- render ------------------------------------------------------------------------
  if (session === undefined) return <main className="center">Loading…</main>;
  if (session === null) return <SignIn />;

  const canAdd = photos.length + busyPhotos < LIMITS.MAX_PHOTOS;
  return (
    <main className="app">
      <header className="topbar">
        <strong>PartsPilot</strong>
        {quota && (
          <span className={`quota${quota.remaining === 0 ? " empty" : ""}`} aria-live="polite">
            {quota.remaining} of {quota.limit} left
          </span>
        )}
        <button type="button" className="link" onClick={() => supabase().auth.signOut({ scope: "local" })}>
          Sign out
        </button>
      </header>

      <Camera disabled={!canAdd || status.kind === "sending"} onShot={(b) => addPhotos([b])} onPick={(f) => addPhotos(f)} />

      <ul className="strip" aria-label="Photos to send">
        {photos.map((p, i) => (
          <li key={p.id}>
            <img src={p.url} alt={`Photo ${i + 1}`} />
            {p.warning && <span className="warn">{p.warning === "blurry" ? "Blurry?" : "Dark?"}</span>}
            <button type="button" className="remove" aria-label={`Remove photo ${i + 1}`} onClick={() => removePhoto(p.id)}>
              ×
            </button>
          </li>
        ))}
        {Array.from({ length: busyPhotos }, (_, i) => (
          <li key={`busy-${i}`} className="busy" aria-label="Processing photo" />
        ))}
      </ul>

      <label className="goal">
        <span className="sr-only">Goal</span>
        <textarea
          value={goal}
          maxLength={LIMITS.MAX_GOAL_CHARS}
          rows={2}
          placeholder="What do you want to build?"
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>

      <button type="button" className="send" disabled={!photos.length || busyPhotos > 0 || status.kind === "sending" || quota?.remaining === 0} onClick={send}>
        {status.kind === "sending" ? "Sending…" : "Send"}
      </button>

      <p className={`status ${status.kind}`} role="status" aria-live="polite">
        {status.kind === "sent" && "Sent – check your PC"}
        {status.kind === "queued" && "Queued, will send automatically"}
        {status.kind === "error" && status.text}
        {status.kind === "idle" && pending > 0 && `${pending} queued, will send automatically`}
      </p>

      {config.turnstileSiteKey && (
        <Turnstile
          ref={turnstile}
          siteKey={config.turnstileSiteKey}
          options={{ execution: "execute", appearance: "interaction-only", action: "upload", size: "flexible" }}
          onWidgetLoad={onTurnstileReady}
        />
      )}
    </main>
  );
}

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setError(null);
    const { error: e } = await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (e) setError("Couldn't start Google sign-in. Check your connection.");
  };
  return (
    <main className="center signin">
      <h1>PartsPilot</h1>
      <p>Photograph your parts. See what you can build on your PC.</p>
      {(!isLocalStack(config.supabaseUrl) || config.googleSignIn) && (
        <button type="button" className="send" onClick={signIn}>
          Sign in with Google
        </button>
      )}
      {error && <p className="status error">{error}</p>}
      {isLocalStack(config.supabaseUrl) && <DevSignIn />}
    </main>
  );
}
