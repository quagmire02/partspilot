# PartsPilot — Architecture (PoC)

Owner: Tech lead. This file is the contract between roles. Change it only when a
contract changes.

## Folder ownership

| Role              | Folder(s)                                   |
|-------------------|---------------------------------------------|
| Tech lead         | `/` root config, `docs/`, `packages/shared` |
| Backend engineer  | `apps/api`, `supabase/`                     |
| AI engineer       | `packages/ai`, `packages/rules`             |
| Data engineer     | `data/`                                     |
| Capture engineer  | `apps/capture`                              |
| Desktop engineer  | `apps/desktop`                              |
| Security engineer | `security/`, `.github/workflows/`           |
| QA engineer       | `e2e/`                                      |

Internal packages (`packages/*`, `data`) export TypeScript source; the consuming
bundler compiles them. `packages/shared` depends on nothing but `zod`.

## System

```
 Phone PWA (Next.js static, Workbox SW)        Windows app (Tauri 2 + React)
   │  Supabase Auth (Google, PKCE)                │  Supabase Auth (PKCE via system browser
   │  POST /v1/jobs (multipart)                   │  + partspilot:// deep link)
   ▼                                              │  REST /v1/*  +  Realtime (jobs table)
 Cloudflare Worker (Hono) ◄────────────────────────┘
   │  verify JWT · rate limit (user+IP) · Turnstile/ticket · quota · sniff+strip images
   │  ── Storage (private bucket `photos`, 5-min signed URLs)
   │  ── Postgres via PostgREST + RPC (service key, server-side only)
   ▼
 Cloudflare Queue `pp-jobs` ──► consumer (same Worker)
   detect (Gemini vision) → match (pgvector + trigram) → [needs_check | auto-accept]
   → classify intent → plan → validate (rules) → repair ≤3 → diagram spec → save
   → jobs row update ──► Supabase Realtime ──► desktop toast + Inbox
```

The phone and PC never talk to each other. The PC can be off; results wait in
`jobs` / `job_results`. On launch (autostart, tray) the desktop catches up on
jobs changed since its last sync and raises one Windows toast.

## Job status (user-visible) vs stage (internal)

| status         | meaning                                                         |
|----------------|-----------------------------------------------------------------|
| `processing`   | stages `queued, detecting, matching, planning, validating, rendering` |
| `needs_check`  | stage `awaiting_confirmation`: ≥1 part below 0.85 confidence     |
| `ready`        | a validated result exists (includes the `refused` verdict)      |
| `needs_review` | no valid plan after 3 repairs, unusable photos, or pipeline error (`error_code` set) |

Re-plan (part change in the desktop) bumps `jobs.plan_version`; queue messages
carry the version and stale messages are dropped.

## Pipeline contracts

1. **Upload** `POST /v1/jobs` multipart: `photos[]` (1–4), `goal`, `client_request_id`
   (UUID, idempotency key), and either `turnstile_token` or `upload_ticket`.
2. **Clean** (Worker, sync): magic-byte sniff (JPEG/PNG/WebP), 10 MB cap per photo,
   metadata strip (JPEG APPn/COM, PNG text/eXIf chunks, WebP EXIF/XMP), dimension
   check ≥ 480 px short edge, SHA-256 per photo. HEIC is converted to JPEG on the
   phone (canvas re-encode, `heic2any` fallback); HEIC bytes reaching the server are
   rejected with `heic_not_converted`.
3. **Detect** — VLM returns `DetectionOutput` (Zod) per image: label, bbox, confidence,
   visible_text, quantity, plus an image quality verdict. Unparseable → retry once → reject.
4. **Match** — catalog search RPC `match_catalog` (pgvector cosine over alias
   embeddings + `pg_trgm` over alias text) → matcher in `packages/ai` scores and
   calibrates → top 3. Auto-accept when top-1 ≥ 0.85, else `needs_check`.
5. **Plan** — intent (`specific` | `discovery`) then planner output `PlannerOutput`
   (Zod). The planner may only use catalog part ids that carry an electrical profile,
   and only pin names from those profiles. Discovery produces 3 plans in parallel.
6. **Validate** — `packages/rules` blocks (never warns) on the rule list in the
   product spec. Issues are fed back to the planner; at most 3 repair attempts.
   Refusal rules short-circuit: no repair, verdict `refused`.
7. **Render** — deterministic `DiagramSpec` (wokwi-elements tags + pin map; generic
   box for parts without a wokwi element). The desktop lays it out and draws wires.
8. **Save** — `job_results` row for `(job_id, plan_version)`, `jobs.status` update →
   Realtime.

Missing parts, buy links and the final verdict are computed by server code from the
catalog, never taken verbatim from the model.

## Offline upload vs. Turnstile (ADR-001)

Turnstile tokens expire after 300 s and are single-use, so a queued upload replayed
hours later cannot carry one. While online, the PWA calls `POST /v1/upload-tickets`
(JWT + Turnstile) and keeps up to 3 single-use tickets (24 h TTL, bound to the user,
consumed atomically in Postgres). Online sends use a fresh Turnstile token; queued
sends use a ticket. The JWT is always refreshed at replay time: the Supabase session
lives in IndexedDB shared by page and service worker; concurrent refreshes are resolved
by supabase-js lockless coordination (server-side token rotation + storage commit guard).

## Auth (ADR-002)

- Supabase Auth, Google provider, `flowType: 'pkce'` on both clients.
- PWA: redirect to `/auth/callback`, session in IndexedDB.
- Desktop: `signInWithOAuth({ skipBrowserRedirect: true })`, open URL in the system
  browser, Supabase redirects to `partspilot://auth/callback?code=…`, deep-link plugin
  (+ single-instance forwarding on Windows) hands the code to `exchangeCodeForSession`.
  Session is stored through the keyring plugin (Windows Credential Manager), chunked
  because a credential blob is limited to 2560 bytes.
- Worker verifies every request's JWT with `jose` against the project JWKS (or the
  HS256 secret for the local stack); issuer and audience are checked.

## Desktop platform layer (ADR-003)

`apps/desktop/src/platform` is the only code that touches Tauri plugins (keyring,
deep-link, notification, autostart, opener, clipboard). A browser implementation of the
same interface lets the identical React UI run under Vite and Playwright against the
local stack; the native shell is checked by `cargo check`, the hardening gate and the
installer smoke test. The window hides to the tray on close so Realtime keeps running and
toasts arrive; autostart launches with `--minimized`. On start, jobs changed since the
last sync raise one collapsed toast (results that arrived while the PC was off).

## Workspace conventions (ADR-004)

Internal packages are TypeScript source consumed only by bundlers (esbuild/wrangler,
Vite, Turbopack, vitest, tsx), so their relative imports are extensionless. `apps/api`
keeps `.js` specifiers (esbuild resolves both).

## Data model (Postgres, all tables RLS-enabled)

User tables (`user_id = auth.uid()` select policy, writes only via service role):
`jobs`, `job_parts`, `job_results`, `inventory_items`, `usage_daily`,
`upload_tickets`, `result_cache`.
Reference tables (authenticated read-only): `catalog_parts`, `catalog_aliases`,
`reference_projects`.

## Limits

See `packages/shared/src/limits.ts` — single source of truth (10 jobs/day,
4 photos, 10 MB, 5-min signed URLs, 0.85 auto-accept, 3 repairs, 30-day photo TTL).

## Caching

Per-user `result_cache`: detection keyed by hash of the cleaned image set + detector
version; plans keyed by hash of (sorted confirmed parts, goal, intent, planner
version). Cache is per user to avoid cross-user inference.

## Logging

`{ event, job_id, user_id, ms, code }` only — never goals, labels, model output,
URLs or tokens. Enforced by the logger's allow-list.

## Self-hosting (ADR-005)

The project also runs entirely on one computer: `scripts/local.mjs` (`pnpm run setup` /
`pnpm start`) starts the Supabase stack in Docker, generates `.dev.vars` and the apps'
`.env.local` from the root `.env`, indexes the catalog with the chosen embedding model and
runs the Worker (wrangler, local Queues) plus the desktop UI in the browser. In this mode:
`TURNSTILE_SECRET=off` (honoured only when `SUPABASE_URL` is local), accounts are local
email + password, and the desktop UI uploads photos itself (**New scan**). AI providers sit
behind `ModelProvider`: Gemini, or any OpenAI-compatible API (`packages/ai/src/openai.ts`,
used for Ollama/LM Studio locally) — still JSON-only, no tools. Result-cache keys include
the provider/model name, so switching models never replays old answers.
