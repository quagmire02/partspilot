/**
 * True when a client talks to a Supabase stack on this machine (`supabase start`).
 * Only then do the clients offer email + password sign-in, so the apps can be tried
 * without a Google OAuth client. Production builds point at https://<ref>.supabase.co.
 */
export function isLocalStack(supabaseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}
