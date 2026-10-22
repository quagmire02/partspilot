/** Public build-time config: Supabase URL + anon key and the API origin. No secrets. */
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  apiUrl: import.meta.env.VITE_API_URL ?? "",
  version: import.meta.env.VITE_APP_VERSION ?? "0.1.0",
  /** Local installs show Google sign-in only when an OAuth client is configured (scripts/local.mjs). */
  googleSignIn: import.meta.env.VITE_GOOGLE_SIGNIN === "1",
};
