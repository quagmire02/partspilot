import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AUTH_STORAGE_KEY } from "./constants";
import { idbStorage } from "./idb";

/**
 * Page and service worker share one session store (IndexedDB). Concurrent refreshes are
 * resolved by Supabase's lockless coordination: server-side parent-of-active token
 * rotation plus a commit guard that re-reads storage before writing.
 */
export function createSupabase(url: string, anonKey: string, opts: { autoRefresh: boolean }): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      flowType: "pkce",
      storage: idbStorage,
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: opts.autoRefresh,
      detectSessionInUrl: false,
    },
  });
}

/** Fresh access token (refreshing if needed), or null when signed out. */
export async function accessToken(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}
