"use client";

import { createApiClient } from "@partspilot/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";
import { accessToken, createSupabase } from "./shared/supabase";

let sb: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  return (sb ??= createSupabase(config.supabaseUrl, config.supabaseAnonKey, { autoRefresh: true }));
}

export const api = createApiClient({
  baseUrl: config.apiUrl,
  getAccessToken: () => accessToken(supabase()),
});
