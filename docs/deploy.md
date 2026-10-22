# Deploying PartsPilot

Order matters: database → auth → Worker → PWA → desktop installer.
Secrets only ever go into `wrangler secret put` (Worker) and the Supabase dashboard.
Client bundles get the Supabase URL + anon/publishable key and public URLs only — CI's
bundle scan fails the build otherwise.

## 1. Supabase

1. Create a project. Note the project URL, the anon (publishable) key and the service-role
   (secret) key.
2. `pnpm --filter @partspilot/api exec supabase link --project-ref <ref> --workdir ../..`
3. `pnpm --filter @partspilot/api exec supabase db push --workdir ../..` — applies the
   migrations (tables, RLS, RPCs, the private `photos` bucket with a 10 MB cap, Realtime on `jobs`).
4. Load the catalog: `psql "<connection string>" -f data/seed/catalog.sql`
5. Embeddings (Gemini): `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… GEMINI_API_KEY=… pnpm --filter @partspilot/data embed`
6. Auth → URL configuration: Site URL = `https://<pwa-domain>`; additional redirect URLs:
   `https://<pwa-domain>/auth/callback`, `partspilot://auth/callback`.
7. Auth → Providers → Google: paste the client id/secret from step 2. Turn **Email off**
   (hosted projects enable it by default; the apps' email form exists only for the local stack).
8. Keep the default asymmetric JWT signing keys (the Worker verifies via JWKS).

## 2. Google OAuth client

Google Cloud console → Credentials → OAuth client ID → *Web application*.
Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.

For the local stack, add `http://127.0.0.1:54321/auth/v1/callback` to the same client
and put its id/secret in `supabase/.env` (see `supabase/.env.example`); without it
Google rejects the placeholder client with "Authorization Error / invalid_client".
While the consent screen is in *Testing*, add each Google account as a test user.
No Google client yet? Builds pointed at the local stack also show an email + password
sign-in (create the account once, use the same email on phone and PC).

## 3. Cloudflare

1. Workers Paid plan (Queues and the 60 s CPU limit in `wrangler.jsonc`).
2. Queues: `wrangler queues create pp-jobs` and `wrangler queues create pp-jobs-dlq`.
3. Turnstile: add a widget for the PWA domain (managed/invisible). Site key → PWA build;
   secret → Worker.
4. In `apps/api/wrangler.jsonc` set `SUPABASE_URL` and `ALLOWED_ORIGINS`
   (`https://<pwa-domain>,http://tauri.localhost`).
5. Secrets:
   ```bash
   cd apps/api
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler deploy --env=""
   ```
6. Route the Worker to `api.<your-domain>`. The daily cron deletes photos older than 30 days.

## 4. Phone PWA (Cloudflare Pages)

Build with public env only:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key> \
NEXT_PUBLIC_API_URL=https://api.<your-domain> \
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key> \
pnpm --filter @partspilot/capture build
pnpm --filter @partspilot/security check:bundles --strict apps/capture/out
```

Deploy `apps/capture/out` to Pages (it contains `_headers` with the CSP and `sw.js`).

## 5. Windows installer

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<anon key> \
VITE_API_URL=https://api.<your-domain> pnpm --filter @partspilot/desktop build:installer
```

Output: `apps/desktop/src-tauri/target/release/bundle/nsis/PartsPilot_<ver>_x64-setup.exe`
(per-user install, registers `partspilot://`, adds autostart on first opt-in).
Sign it (Authenticode, `bundle.windows.certificateThumbprint` or `signCommand`) — unsigned
installers trigger SmartScreen warnings.

## 6. Smoke test

Sign in on phone and PC with the same Google account, photograph a parts pile, ask
"Can I build an RC car?". The PC shows a toast and the result within ~60 s.
