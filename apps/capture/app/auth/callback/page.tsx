"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../src/client";

/** OAuth (PKCE) return: exchange the code for a session, then go to the camera. */
export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setError(params.get("error_description") ? "Sign-in was cancelled or failed." : "Missing sign-in code.");
      return;
    }
    supabase()
      .auth.exchangeCodeForSession(code)
      .then(({ error: e }) => {
        if (e) setError("Sign-in failed. Please try again.");
        else window.location.replace("/");
      });
  }, []);

  return (
    <main className="center">
      {error ? (
        <>
          <p className="status error">{error}</p>
          <a href="/">Back</a>
        </>
      ) : (
        <p>Signing you in…</p>
      )}
    </main>
  );
}
