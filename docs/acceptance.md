# Milestone acceptance

Each milestone's tests passed once before moving on. Re-run with the commands in the
README. "Local stack" = Supabase (Postgres 17, PostgREST, Auth, Storage, Realtime) in
Docker + `wrangler dev --env local` (Queues simulated) + the mock model provider.

| # | Milestone | Acceptance evidence |
|---|-----------|---------------------|
| 1 | Contracts | `packages/shared`: 16 tests — model output rejected unless it parses; typed client maps errors; OpenAPI documents every route under bearer auth |
| 2 | Backend + security | DB 13 tests on real Postgres semantics (PGlite): RLS on every table, owner-only reads, client writes denied, server RPCs not executable by clients, atomic 10/day quota, idempotent uploads, single-use tickets, inventory idempotency, 30-day photo expiry. API 83 tests: JWT on every route, per-IP + per-user rate limits, Turnstile/ticket, MIME sniffing, 10 MB cap, EXIF/XMP/ICC strip, HEIC rejected server-side, 5-min signed URLs, logs carry no user text, queue retry/DLQ. Security 4 tests + live RLS gate; also verified on the real local Supabase |
| 3 | Component data | 1,793 Fritzing parts + 6 KiCad symbols imported; 94 curated electrical profiles; 30 reference projects. 45 tests incl. KiCad electrical-type cross-check and wokwi pin maps. Seed loads into real Postgres (1,439 parts, 4,409 aliases) |
| 4 | AI pipeline | Rules 56 tests: all 30 reference builds pass; every blocking rule fires on a minimal bad circuit; RC-car budget computed exactly (626 mA). AI 33 tests: Gemini request shape (no tools), retry/degrade, box conversion, calibrated matching, hazard screening, repair loop (fix on 2nd call; stop after 3 repairs), prompt-injection containment, discovery. Local stack: photo → ready in ~2.8 s, all 5 parts matched to exact names and auto-accepted |
| 5 | Phone capture | Playwright (Chromium, Pixel 7): sign-in screen; live camera shutter; 4-photo limit; "Sent – check your PC" within 2 s (≈0.1 s once the ticket pool is warm); quota "N of 10 left"; offline → "Queued, will send automatically" → delivered by the service worker when back online. 11 unit tests |
| 6 | Windows app | Playwright on the desktop UI: inbox → photo boxes, exact names, verdict, missing parts + buy links, wokwi diagram, 9 steps, code + Copy; changing a part re-plans automatically (verdict updates); inventory; inventory discovery → 3 project cards. 15 unit tests (keyring chunking, deep-link guard, toasts, layout, sanitized markdown). Rust app compiles; Tauri hardening gate passes |
| 7 | End-to-end + installer | Cross-device journey: phone UI send → PC Inbox updates live over Realtime → Ready ~3.8 s later → validated result. Real-stack isolation: a second user gets nothing via API, PostgREST, RPC or Storage. NSIS installer (1.58 MiB, per-user): silent install registers `partspilot://` and an uninstall entry; the installed app opens its window with the production CSP and renders sign-in; a `partspilot://` link is forwarded to the running instance (single instance); `--minimized` (autostart) runs hidden in the tray; uninstall removes the app, the protocol handler and the uninstall entry. Bundle secret scan and hardening gate pass on the shipped config |

## Not verifiable without your accounts

- Google sign-in end to end (needs the OAuth client): code paths are tested up to the
  provider redirect; desktop deep-link handling is unit-tested. Until a client exists, builds
  pointed at the local stack offer email + password sign-in (Playwright `signin-journey`:
  account created on the phone UI, same login on the PC UI, both survive reload).
- Real Gemini detection/planning quality and the 60 s budget with real model latency:
  `GEMINI_API_KEY=… pnpm --filter @partspilot/ai test` (+ `E2E_PHOTO=pile.jpg`).
- Turnstile with a real site key; Workers rate limits and Queues in production.
- Windows toast/keyring/deep link inside the installed app with a production build.

## Known limitations (PoC)

- In the Claude desktop app's browser pane, service-worker network requests are blocked;
  use Chromium/Chrome (Playwright verifies the offline queue there).
- Multi-photo de-duplication counts each part from the photo where it appears most.
- Parts without an electrical profile (most Fritzing entries) can be confirmed and kept
  in inventory but are not wired by the planner.
- HEIC is converted on the phone; HEIC bytes reaching the server are rejected.
