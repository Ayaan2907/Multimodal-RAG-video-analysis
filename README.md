# Video RAG

Timestamped video understanding: ingest an upload or a YouTube link, get
transcription, topic chunking, embeddings, and a chat interface where every
answer cites the exact video segments that support it.

## Security model

- **Secrets are env-only.** There is no code fallback for any API key. The
  previously committed Supabase service-role key has been removed from the
  source; rotate it from the Supabase dashboard if you deployed any earlier
  revision of this repository.
- **Private media storage.** Video and audio buckets are private; playback and
  transcription use short-lived signed URLs minted server-side.
- **API keys with scopes.** Every `/api/*` route requires a Bearer API key
  (`vidrag_sk_…`). Keys are stored hashed (SHA-256), belong to an organization,
  carry scopes (`ingest:write`, `library:read`, `chat:run`), and are rate
  limited per key. Unauthorized requests get 401; scope mismatches get 403.
  Database lookups for video data are organization-scoped.

## Setup

1. Install [Bun](https://bun.sh) and run `bun install`.
2. Copy `.env.example` to `.env.local` and fill in your Supabase and AI provider
   credentials.
3. Apply the schema: run `supabase/migrations/0001_init.sql` against your
   database (psql or the Supabase SQL editor). It creates organizations, API
   keys, the video/chunk/embedding tables with pgvector, the
   `match_embeddings` RPC, deny-by-default RLS, and the private buckets.
4. Create your first API key:

   ```bash
   bun run keys:create   # prints the plaintext key exactly once
   ```

5. Enter the key in the app's banner (stored in your browser's localStorage) or
   call the API with `Authorization: Bearer vidrag_sk_…`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server |
| `bun run build` | Production build |
| `bun run lint` | ESLint |
| `bun run test` | Vitest suite |
| `bun run scan:secrets` | Scan tracked files for credential-shaped strings |
| `bun run keys:create` | Create an organization API key |

## API

All routes require `Authorization: Bearer vidrag_sk_…`.

| Route | Scope | Purpose |
| --- | --- | --- |
| `POST /api/upload` | `ingest:write` | Multipart video upload (≤100 MB), async processing |
| `POST /api/youtube/extract` | `ingest:write` | Start processing a YouTube URL |
| `GET /api/videos/{id}/status` | `library:read` | Processing status/progress |
| `POST /api/chat` | `chat:run` | Ask a video a question; returns answer + timestamped sources |


## MCP server

An MCP server exposes the API v1 surface to coding agents (`mcp/`). It is a
thin client of API v1 — every tool call is one authenticated HTTP request; it
holds no database access and no pipeline logic of its own.

- **Tools:** `ingest_video`, `get_video`, `search`, `ask_video`, `get_transcript`
- **Resource:** `video://{videoId}/transcript` — the timestamped markdown transcript

Configure it with two environment variables:

| Variable | Meaning |
| --- | --- |
| `VIDEO_RAG_API_URL` | API origin, e.g. `https://api.example.com` |
| `VIDEO_RAG_API_KEY` | Organization API key (`vidrag_sk_…`) |

Run over stdio (this is what an MCP client invokes):

```bash
VIDEO_RAG_API_URL=https://api.example.com VIDEO_RAG_API_KEY=vidrag_sk_… bun run mcp
```

Or in an MCP client config:

```json
{
  "mcpServers": {
    "video-rag": {
      "command": "bun",
      "args": ["run", "mcp"],
      "env": {
        "VIDEO_RAG_API_URL": "https://api.example.com",
        "VIDEO_RAG_API_KEY": "vidrag_sk_…"
      }
    }
  }
}
```

Smoke-test it against fixture data (no Supabase or AI keys needed) — start the
fixture API v1 server, then drive the MCP server with the inspector:

```bash
bun run mcp:fixtures   # fixture API v1 on http://127.0.0.1:8977
npx -y @modelcontextprotocol/inspector --cli bun run mcp \
  --method tools/call --tool-name ask_video \
  --tool-arg video_id=vid_fixture_001 --tool-arg message="When was the contract signed?"
```

## Deploy (Railway)

The repo ships `railway.json` + `nixpacks.toml`: bun install/build from the
committed lockfile, `next start`, **ffmpeg in the image** (audio extraction for
uploads), and a healthcheck on `GET /api/health` (shallow liveness — no auth,
no database, no secrets).

1. Create a Railway service from this repo.
2. Set the environment variables below as config variables. They are visible to
   both build and runtime; `NEXT_PUBLIC_*` must be set before the **first
   build**, because Next.js inlines them into the client bundle.
3. Deploy — Railway waits for `/api/health` before marking the deployment live.

### Environment variable manifest

| Variable | Read at | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | build + runtime | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build + runtime | yes | Supabase anon key (browser client) |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime | yes | Server-only service role (must be a **rotated** key — never a key that was ever committed) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | runtime | yes | Gemini: transcription, embeddings, analysis |
| `GROQ_API_KEY` | runtime | for chat | Groq chat completions; required for chat/search surfaces |
| `ASSEMBLYAI_API_KEY` | runtime | optional | Alternative transcription provider |
| `YOUTUBE_API_KEY` | runtime | optional | Richer YouTube metadata |
| `GEMINI_FLASH_MODEL` / `GEMINI_EMBEDDING_MODEL` / `GROQ_CHAT_MODEL` | runtime | optional | Pin model IDs (alive defaults baked in) |
| `MATCH_THRESHOLD` | runtime | optional | Retrieval similarity floor, default 0.5 |
| `EMBEDDING_DIMENSIONS` | runtime | optional | Vector size; 768 keeps pgvector + RPCs compatible |
| `MAX_VIDEO_DURATION_MINUTES` | runtime | optional | Default 30 |
| `TEMP_DIR` | runtime | optional | Scratch dir for media temp files, default `/tmp` |
| `WEBHOOK_TOLERANCE_SECONDS` | runtime | optional | Webhook replay window, default 300 |
| `NEXT_PUBLIC_APP_URL` | build | optional | Bare deployment hostname (no scheme) for canonical/OG URLs |

Full API contract, quickstart, webhook signature scheme, and MCP config live on
the deployed app at `/docs`.
