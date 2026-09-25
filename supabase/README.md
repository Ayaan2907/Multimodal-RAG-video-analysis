# Supabase migrations

The app's schema lives in versioned SQL files, applied in lexicographic order.

## Apply to a fresh Supabase project

Either via the Supabase CLI:

```sh
supabase db push
```

Or directly against the project database:

```sh
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

(`DATABASE_URL` is the project's Postgres connection string; alternatively run
the file contents in the Supabase dashboard SQL editor.)

## What 0001_init.sql creates

- `organizations`, `api_keys` (hashed keys + scopes, see `lib/auth/`)
- `videos` (with `organization_id` tenancy column), `transcripts`,
  `transcript_segments`, `video_chunks`, `embeddings` (`vector(768)` + hnsw index)
- `match_embeddings` RPC used by the chat route
- `updated_at` triggers
- Row Level Security enabled deny-by-default (server access is service-role only)
- Private storage buckets `videos` and `audio-files`

## Creating an API key

```sh
bun run keys:create -- --org "Acme Law" --name "ci-ingest"
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in env.
The plaintext key (`vidrag_sk_…`) is printed **once** — only its SHA-256 hash is stored.
