/** Public build-time config. Only the Supabase URL + anon key and public endpoints. */
export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  /** Local installs show Google sign-in only when an OAuth client is configured (scripts/local.mjs). */
  googleSignIn: process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "1",
};

export { AUTH_STORAGE_KEY } from "./shared/constants";
