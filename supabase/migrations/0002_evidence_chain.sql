-- Evidence chain of custody (spec art_HKWx4t5y §3).
--
-- videos.content_sha256: SHA-256 of the ingested content, computed at ingest
--   (scope 'file' — the uploaded bytes — or 'transcript' — the transcript we
--   hold for remote sources such as YouTube).
-- chunk_provenance: one row per chunk linking it to (video, source hash,
--   offset range, embedding model version) so any retrieval can be traced
--   back to the exact evidence asset that produced it.

begin;

alter table public.videos
  add column if not exists content_sha256 text,
  add column if not exists content_hash_scope text;

-- Scope is only meaningful alongside a hash, and constrained to the two
-- content classes we hash.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'videos_content_hash_scope_check'
  ) then
    alter table public.videos
      add constraint videos_content_hash_scope_check
      check (content_hash_scope is null or content_hash_scope in ('file', 'transcript'));
  end if;
end $$;

create table if not exists public.chunk_provenance (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references public.video_chunks(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  chunk_index integer not null,
  start_time_seconds double precision not null,
  end_time_seconds double precision not null,
  -- Hash of the content the chunk was derived from; null only for legacy
  -- assets ingested before hashing existed. The manifest reports it as-is.
  source_sha256 text,
  embedding_model text,
  created_at timestamptz not null default now(),
  unique (chunk_id)
);

create index if not exists chunk_provenance_video_id_idx
  on public.chunk_provenance (video_id, chunk_index);

alter table public.chunk_provenance enable row level security;

commit;
