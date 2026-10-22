# PartsPilot

Photograph a pile of electronics parts, ask a question like **"Can I build an RC car?"**,
and get back:

- the **exact name** of each part it recognised, boxed on your photo (you can correct
  any of them, and the plan updates automatically);
- a **yes / no verdict**, the **missing parts** with shop links;
- **wiring** that has passed an electrical safety check, a **wiring diagram** and
  numbered **build steps**;
- ready-to-paste **Arduino C++ or MicroPython code** with the libraries it needs;
- **safety notes**. Mains power, unprotected LiPo charging and weapon-like builds are refused.

Leave the question empty and you get **3 project ideas** for the parts you have instead.
Confirmed parts go into **My Inventory**, so later you can ask "what can I build with
my inventory?"

Everything runs **on your own computer**: a local database in Docker, a small local API
server and the app in your browser. The AI can be a **free local model (Ollama)** or an
**API** (any OpenAI-compatible service, or Google Gemini).

## How it works

```
photos ─► clean (strip location data) ─► AI finds parts + boxes ─► match to a catalog of
1,400+ real parts ─► you confirm/correct ─► AI drafts a plan ─► rule engine checks the
wiring (voltages, current, drivers, grounds, pins) ─► AI repairs it (up to 3×) ─►
diagram + steps + code
```

The AI never has the last word on safety. A deterministic rule engine blocks 5 V into
3.3 V pins, motors/relays on bare GPIO pins, missing common grounds, overloaded pins
or supplies, misused boot pins, and more. A plan that fails the check is never shown
as buildable.

## Requirements

- **Node.js 22+** (https://nodejs.org). pnpm comes with it via `corepack`.
- **Docker Desktop**, running (https://www.docker.com/products/docker-desktop). The local database lives in it.
- **An AI**, one of:
  - **Ollama** (free, private, offline; https://ollama.com). A GPU with 6 GB+ VRAM or 16 GB RAM is recommended.
  - **An API key**: OpenAI, Groq, OpenRouter, LM Studio (local), or anything else
    that speaks the OpenAI API, or a Google Gemini key.

## Setup

```bash
git clone <this repo> partspilot
cd partspilot
corepack enable
pnpm install
cp .env.example .env        # Windows PowerShell: copy .env.example .env
```

Choose your AI in `.env` (option A or B below), then:

```bash
pnpm run setup     # starts the local database, writes config, prepares the parts catalog
pnpm start         # opens http://localhost:1420
```

The first `pnpm run setup` downloads the database's Docker images (a few minutes).
Afterwards, `pnpm start` is all you need. `pnpm run stop` shuts the database down; your
data is kept.

In the app, **create an account**: any email and a 6+ character password. It stays on
your computer and no email is sent. Then click **+ New scan**, drop in up to 4 photos,
type what you want to build and click **Find what I can build**.

### Option A: local LLM with Ollama (free, private)

1. Install Ollama from https://ollama.com and make sure it is running.
2. Download a vision model and an embedding model:

   ```bash
   ollama pull qwen2.5vl:7b
   ollama pull nomic-embed-text
   ```

   On smaller PCs use `qwen2.5vl:3b` and set `OLLAMA_MODEL=qwen2.5vl:3b` in `.env`.
3. Give Ollama a larger context window, because the planning prompts are long. Set the
   environment variable `OLLAMA_CONTEXT_LENGTH=16384` and restart Ollama.
   - Windows: *Settings → System → About → Advanced system settings → Environment Variables*, then quit Ollama from the tray and start it again.
   - macOS/Linux: `OLLAMA_CONTEXT_LENGTH=16384 ollama serve`.
4. In `.env`: `AI_PROVIDER=ollama` (the default).

Local models are slower and less accurate than the big hosted ones: expect 1–5 minutes
per scan on a mid-range GPU, and check the part names it suggests. The rule engine
still blocks unsafe wiring whatever model you use.

### Option B: an API

**Any OpenAI-compatible API** (OpenAI, Groq, OpenRouter, LM Studio, …). In `.env`:

```ini
AI_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1      # or your provider's /v1 URL
OPENAI_API_KEY=sk-...
OPENAI_MODEL=<a vision-capable model from your provider>
OPENAI_EMBED_MODEL=text-embedding-3-small      # must give 768-dim vectors (or support `dimensions`)
```

If your provider has no embeddings endpoint (Groq, for example), keep the chat on the
API and do embeddings locally with Ollama (`ollama pull nomic-embed-text`):

```ini
EMBED_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_EMBED_MODEL=nomic-embed-text
```

**Google Gemini.** Get a key at https://aistudio.google.com/apikey, then in `.env`:

```ini
AI_PROVIDER=gemini
GEMINI_API_KEY=...
```

**After changing the AI provider or the embedding model, run `pnpm run setup` again.**
It re-indexes the parts catalog with the new model (about 4,400 part names).

Your keys stay in `.env`, which is gitignored. Photos go only to the AI you chose.

## Optional extras

- **Phone capture app** (camera, offline queue) and the **native Windows app** (Tauri,
  tray, notifications, installer) are in `apps/capture` and `apps/desktop`. Phone capture
  needs HTTPS, so it is meant for a hosted deployment: see [docs/deploy.md](docs/deploy.md).
  The native app needs Rust: `pnpm --filter @partspilot/desktop dev:app`.
- **Daily limit**: 10 scans per account per day, set in `packages/shared/src/limits.ts`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Docker is not running` | Start Docker Desktop and wait until it says it is running. |
| `Download the AI models first` | Run the `ollama pull …` lines it prints. |
| A scan stays **Needs review** | The AI timed out or returned something unusable. With Ollama, check `OLLAMA_CONTEXT_LENGTH`, try a smaller model, or raise `AI_TIMEOUT_MS` in `.env`. Then start a new scan. |
| Part names look random | The catalog was indexed with a different embedding model. Run `pnpm run setup`. |
| `embedding_dims_…_need_768` | Use an embedding model with 768 dimensions (`nomic-embed-text`, `text-embedding-3-small`). |
| Port 1420, 8787 or 54321 in use | Stop the other program, or run `pnpm run stop` and `pnpm start` again. |

## Project layout

```
apps/desktop    The app (React + Vite; also packages as a Tauri 2 Windows app)
apps/api        API + job pipeline (Cloudflare Worker code, run locally with wrangler)
apps/capture    Phone PWA (Next.js static export + Workbox service worker)
packages/ai     AI providers (OpenAI-compatible / Ollama, Gemini), prompts, matcher, planner
packages/rules  Electrical rule engine (blocks, never warns)
packages/shared Zod contracts, typed API client, OpenAPI
data/           Fritzing/KiCad importers, curated part profiles, 30 reference projects
supabase/       Postgres schema with row-level security, local database config
scripts/        local.mjs: setup / start / stop
e2e/, security/ End-to-end tests and security gates
docs/           Architecture, hosted deployment, acceptance results
```

## Development

```bash
pnpm test                 # unit + contract tests
pnpm typecheck
# End-to-end tests use the canned mock AI: set AI_PROVIDER=mock in .env, run `pnpm run setup`
# and `pnpm start`, then:
LOCAL_STACK=1 pnpm --filter @partspilot/e2e exec vitest run
LOCAL_STACK=1 pnpm --filter @partspilot/e2e exec playwright test
```

`AI_PROVIDER=mock` returns the same canned parts and plan for every photo. Use it only
for tests.

## License

Code: [MIT](LICENSE). The bundled part data keeps its own licences (below); if you
redistribute `data/`, keep its attribution and share-alike terms.

## Credits

Part data comes from the [Fritzing parts library](https://github.com/fritzing/fritzing-parts)
(CC BY-SA 3.0) and [KiCad symbols](https://gitlab.com/kicad/libraries/kicad-symbols)
(CC BY-SA 4.0); details are in [data/LICENSES.md](data/LICENSES.md). Diagrams use
[wokwi-elements](https://github.com/wokwi/wokwi-elements) (MIT).
