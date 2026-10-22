"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "../client";

/**
 * Email + password sign-in, rendered only against the local Supabase stack (see
 * isLocalStack) so the app can be tried without a Google OAuth client. Use the same
 * email in the desktop app to see this phone's scans there.
 */
export function DevSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: "in" | "up") => {
    setBusy(true);
    setError(null);
    const auth = supabase().auth;
    const { data, error: e } = mode === "in" ? await auth.signInWithPassword({ email, password }) : await auth.signUp({ email, password });
    setBusy(false);
    if (e) setError(e.message);
    else if (!data.session) setError("Account created, but this stack requires email confirmation.");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run("in");
  };

  return (
    <form className="dev-signin" onSubmit={onSubmit}>
      <p className="dev-note">Sign in, or create an account that stays on this computer.</p>
      <input type="email" autoComplete="username" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" autoComplete="current-password" placeholder="Password (6+ characters)" aria-label="Password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <div className="dev-actions">
        <button type="submit" disabled={busy}>Sign in</button>
        <button type="button" disabled={busy || !email || password.length < 6} onClick={() => void run("up")}>Create account</button>
      </div>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
