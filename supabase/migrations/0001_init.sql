-- Initial schema for the Video RAG revival (spec art_HKWx4t5y §1).
--
-- The repo previously shipped with NO migrations — the production schema was
-- undocumented (audit §4). This file restores the full schema from a clean
-- database. Apply in order with either:
--   supabase db push
-- or:
--   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql

begin;

create extension if not exists vector;

-- ===========================================================================
-- Tenancy: organizations and API keys
-- ===========================================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Only the SHA-256 hash of a key is stored; plaintext keys are shown once at
-- creation time (scripts/create-api-key.mjs) and never persisted.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'default',
  key_hash text not null unique,
  key_display_prefix text not null,
  scopes text[] not null default '{ingest:write,library:read,chat:run}',
  rate_limit_per_minute integer not null default 60,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_organization_id_idx
  on public.api_keys (organization_id);

-- ===========================================================================
-- Content pipeline (schema reconstructed from code, audit §4)
-- ===========================================================================

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  title text not null,
  description text,
  source_type text not null check (source_type in ('upload', 'youtube')),
  source_url text,
  file_path text,
  thumbnail_url text,
  duration_seconds double precision,
  file_size_bytes bigint,
  processing_status text not null default 'uploading'
    check (processing_status in ('uploading', 'processing', 'chunking', 'transcribing', 'embedding', 'completed', 'failed')),
  processing_error text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists videos_organization_id_idx on public.videos (organization_id);

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  content text,
  language text,
  confidence_score double precision,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transcripts_video_id_idx on public.transcripts (video_id);

create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  text_content text not null,
  start_time_seconds double precision not null,
  end_time_seconds double precision not null,
  confidence_score double precision,
  speaker_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transcript_segments_video_id_idx on public.transcript_segments (video_id);
create index if not exists transcript_segments_transcript_id_idx on public.transcript_segments (transcript_id);

create table if not exists public.video_chunks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  chunk_number integer,
  title text,
  description text,
  start_time_seconds double precision not null,
  end_time_seconds double precision not null,
  duration_seconds double precision,
  transcript_text text,
  visual_description text,
  key_frames jsonb,
  topics jsonb,
  entities jsonb,
  created_at timestamptz not null default now()
);

create index if not exists video_chunks_video_id_idx
  on public.video_chunks (video_id, start_time_seconds);

create table if not exists public.embeddings (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  chunk_id uuid references public.video_chunks(id) on delete cascade,
  content_type text not null check (content_type in ('transcript', 'visual', 'multimodal')),
  content_text text not null,
  embedding vector(768) not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists embeddings_video_id_idx on public.embeddings (video_id);
create index if not exists embeddings_chunk_id_idx on public.embeddings (chunk_id);
-- hnsw supports up to 2000 dimensions; vector(768) fits.
create index if not exists embeddings_embedding_hnsw_idx
  on public.embeddings using hnsw (embedding vector_cosine_ops);

-- ===========================================================================
-- Vector search RPC (called via supabase.rpc('match_embeddings', ...))
-- ===========================================================================

create or replace function public.match_embeddings(
  query_embedding vector(768),
  match_threshold double precision default 0.5,
  match_count integer default 5,
  filter_video_id uuid default null
)
returns table (
  id uuid,
  video_id uuid,
  chunk_id uuid,
  content_type text,
  content_text text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    e.id,
    e.video_id,
    e.chunk_id,
    e.content_type,
    e.content_text,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.embeddings e
  where 1 - (e.embedding <=> query_embedding) >= match_threshold
    and (filter_video_id is null or e.video_id = filter_video_id)
  order by e.embedding <=> query_embedding asc
  limit match_count;
$$;

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_videos_updated_at on public.videos;
create trigger set_videos_updated_at
  before update on public.videos
  for each row execute function public.set_updated_at();

drop trigger if exists set_transcripts_updated_at on public.transcripts;
create trigger set_transcripts_updated_at
  before update on public.transcripts
  for each row execute function public.set_updated_at();

drop trigger if exists set_transcript_segments_updated_at on public.transcript_segments;
create trigger set_transcript_segments_updated_at
  before update on public.transcript_segments
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Row Level Security
--
-- Deny-by-default: no anon/authenticated policies are granted on purpose.
-- All server access flows through the service-role client (bypasses RLS)
-- behind API-key authentication in the Next.js routes. User-facing policies
-- arrive with the Supabase-session UI workstream.
-- ===========================================================================

alter table public.organizations enable row level security;
alter table public.api_keys enable row level security;
alter table public.videos enable row level security;
alter table public.transcripts enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.video_chunks enable row level security;
alter table public.embeddings enable row level security;

-- ===========================================================================
-- Storage buckets — private (the audit flagged public buckets as a critical
-- issue; playback uses short-lived signed URLs served by the app).
-- ===========================================================================

insert into storage.buckets (id, name, public)
values
  ('videos', 'videos', false),
  ('audio-files', 'audio-files', false)
on conflict (id) do update set public = false;

commit;
