import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createApiClient, DESKTOP_AUTH_CALLBACK } from "@partspilot/shared";
import { config } from "./config";
import type { Platform } from "./platform";

const PENDING_KEY = "pp-signin-pending-until";
const PENDING_MS = 10 * 60 * 1000;

let sb: SupabaseClient | null = null;
let plat: Platform | null = null;

/** User profile (non-secret) lives in localStorage; tokens go to the OS keyring. */
const localUserStorage = {
  getItem: (k: string) => localStorage.getItem(k),
  setItem: (k: string, v: string) => localStorage.setItem(k, v),
  removeItem: (k: string) => localStorage.removeItem(k),
};

export function initAuth(p: Platform): SupabaseClient {
  plat = p;
  sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      storage: p.secureStore,
      userStorage: localUserStorage,
      storageKey: "pp-desktop-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return sb;
}

export function supabase(): SupabaseClient {
  if (!sb) throw new Error("auth not initialised");
  return sb;
}

export const api = createApiClient({
  baseUrl: config.apiUrl,
  getAccessToken: async () => (await supabase().auth.getSession()).data.session?.access_token ?? null,
});

/** Opens Google sign-in in the default browser; the result returns via partspilot://auth/callback. */
export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: DESKTOP_AUTH_CALLBACK, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) throw new Error("signin_start_failed");
  localStorage.setItem(PENDING_KEY, String(Date.now() + PENDING_MS));
  await plat!.openExternal(data.url);
}

export type DeepLinkResult = "signed_in" | "ignored" | "error";

/**
 * Accepts a callback only while a sign-in started from this app is pending. Even a
 * forged link cannot sign the user into another account: PKCE requires our verifier.
 */
export async function handleDeepLink(url: string, now = Date.now()): Promise<DeepLinkResult> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "ignored";
  }
  const isCallback = u.protocol === "partspilot:" && (u.host === "auth" || u.hostname === "auth") && u.pathname.replace(/\/+$/, "") === "/callback";
  if (!isCallback) return "ignored";
  const pendingUntil = Number(localStorage.getItem(PENDING_KEY) ?? 0);
  if (!pendingUntil || now > pendingUntil) return "ignored";
  localStorage.removeItem(PENDING_KEY);
  const code = u.searchParams.get("code");
  if (!code) return "error";
  const { error } = await supabase().auth.exchangeCodeForSession(code);
  return error ? "error" : "signed_in";
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut({ scope: "local" });
  localStorage.removeItem("pp-last-sync");
}
