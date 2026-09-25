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
