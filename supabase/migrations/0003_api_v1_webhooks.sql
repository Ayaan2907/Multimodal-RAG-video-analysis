-- API v1 surface: idempotent ingest, signed webhooks, org-scoped search.
-- (spec art_HKWx4t5y §4)

begin;

-- ---------------------------------------------------------------------------
-- Idempotency — POST /api/v1/ingest with an Idempotency-Key header replays
-- the first result: one key, one org, one endpoint → one video record.
-- ---------------------------------------------------------------------------
create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint text not null,
  idempotency_key text not null,
  video_id uuid references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, endpoint, idempotency_key)
);

create index if not exists idempotency_keys_video_id_idx
  on public.idempotency_keys (video_id);

-- ---------------------------------------------------------------------------
-- Webhooks — per-org delivery endpoints. The signing secret is stored
-- plaintext (it must be presented to compute HMACs at delivery time); it is
-- generated server-side at endpoint creation and never accepted from clients.
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null default '{video.completed}',
  created_at timestamptz not null default now()
);

create index if not exists webhook_endpoints_organization_id_idx
  on public.webhook_endpoints (organization_id);

-- One row per delivery attempt: the observability trail for retries.
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  attempt integer not null,
  ok boolean not null,
  status_code integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_endpoint_idx
  on public.webhook_deliveries (endpoint_id, created_at);

-- ---------------------------------------------------------------------------
-- Org-scoped vector search. match_embeddings (0001) can only filter one video
-- or none — none leaks every org's embeddings into a ranking. This variant
-- makes the organization filter mandatory and optional video-id filters
-- explicit, so POST /api/v1/search is scoped server-side.
-- ---------------------------------------------------------------------------
create or replace function public.match_embeddings_org(
  query_embedding vector(768),
  match_threshold double precision default 0.5,
  match_count integer default 10,
  p_organization_id uuid default null,
  p_video_ids uuid[] default null
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
    and e.video_id in (
      select v.id from public.videos v where v.organization_id = p_organization_id
    )
    and (p_video_ids is null or e.video_id = any(p_video_ids))
  order by e.embedding <=> query_embedding asc
  limit match_count;
$$;

alter table public.idempotency_keys enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

commit;
