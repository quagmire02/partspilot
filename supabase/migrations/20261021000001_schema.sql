-- PartsPilot core schema. Every table has RLS enabled (CI enforces this).
-- Clients (anon/authenticated) can only SELECT their own rows; all writes go through
-- the Worker with the service role.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Reference data (global, read-only for signed-in users)
-- ---------------------------------------------------------------------------

create table public.catalog_parts (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
  name text not null check (char_length(name) between 2 and 120),
  category text not null,
  manufacturer text,
  source text not null check (source in ('fritzing', 'kicad', 'curated')),
  source_ref text,
  license text,
  buy_query text not null,
  profile jsonb,
  has_profile boolean generated always as (profile is not null) stored,
  updated_at timestamptz not null default now()
);

create table public.catalog_aliases (
  id bigint generated always as identity primary key,
  part_id text not null references public.catalog_parts (id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 120),
  alias_norm text generated always as (lower(alias)) stored,
  embedding extensions.vector(768),
  unique (part_id, alias)
);
create index catalog_aliases_part_idx on public.catalog_aliases (part_id);
create index catalog_aliases_embedding_idx on public.catalog_aliases
  using hnsw (embedding extensions.vector_cosine_ops);
create index catalog_aliases_trgm_idx on public.catalog_aliases
  using gin (alias_norm extensions.gin_trgm_ops);

create table public.reference_projects (
  id text primary key,
  title text not null,
  goal_examples text[] not null default '{}',
  plan jsonb not null,
  embedding extensions.vector(768),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- User data
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_request_id uuid not null,
  source text not null check (source in ('photo', 'inventory')),
  goal text check (char_length(goal) <= 500),
  intent text check (intent in ('specific', 'discovery')),
  status text not null default 'processing'
    check (status in ('processing', 'needs_check', 'ready', 'needs_review')),
  stage text not null default 'queued'
    check (stage in ('queued', 'detecting', 'matching', 'awaiting_confirmation', 'planning',
                     'validating', 'rendering', 'done', 'failed')),
  plan_version int not null default 0 check (plan_version >= 0),
  error_code text,
  photo_count int not null default 0 check (photo_count between 0 and 4),
  photo_paths text[] not null default '{}',
  -- [{ index, width, height, bytes, sha256, mime }]
  photo_meta jsonb not null default '[]',
  image_set_hash text,
  photos_deleted_at timestamptz,
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);
create index jobs_user_updated_idx on public.jobs (user_id, updated_at desc);
create index jobs_user_created_idx on public.jobs (user_id, created_at desc);
create index jobs_photo_expiry_idx on public.jobs (created_at)
  where photos_deleted_at is null and photo_count > 0;

create table public.job_parts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  image_index int check (image_index between 0 and 3),
  bbox jsonb,
  label text not null check (char_length(label) <= 120),
  visible_text text[] not null default '{}',
  detection_confidence real not null default 0,
  candidates jsonb not null default '[]',
  part_id text references public.catalog_parts (id),
  confidence real not null default 0 check (confidence between 0 and 1),
  quantity int not null default 1 check (quantity between 1 and 50),
  status text not null check (status in ('auto', 'needs_check', 'confirmed', 'added', 'removed')),
  -- same part seen again in another photo of the pile: drawn, but not counted
  duplicate boolean not null default false,
  -- bookkeeping so re-confirming a job never double-counts inventory
  inventory_part_id text references public.catalog_parts (id),
  inventory_applied int not null default 0 check (inventory_applied >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_parts_job_idx on public.job_parts (job_id);
create index job_parts_user_idx on public.job_parts (user_id);

create table public.job_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_version int not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (job_id, plan_version)
);
create index job_results_user_idx on public.job_results (user_id);

create table public.inventory_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  part_id text not null references public.catalog_parts (id),
  quantity int not null check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, part_id)
);

create table public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  jobs int not null default 0 check (jobs >= 0),
  primary key (user_id, day)
);

create table public.upload_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index upload_tickets_user_idx on public.upload_tickets (user_id);

create table public.result_cache (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  kind text not null check (kind in ('detect', 'plan')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();
create trigger job_parts_updated_at before update on public.job_parts
  for each row execute function public.set_updated_at();
create trigger inventory_items_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.catalog_parts enable row level security;
alter table public.catalog_aliases enable row level security;
alter table public.reference_projects enable row level security;
alter table public.jobs enable row level security;
alter table public.job_parts enable row level security;
alter table public.job_results enable row level security;
alter table public.inventory_items enable row level security;
alter table public.usage_daily enable row level security;
alter table public.upload_tickets enable row level security;
alter table public.result_cache enable row level security;

create policy catalog_parts_read on public.catalog_parts
  for select to authenticated using (true);
create policy catalog_aliases_read on public.catalog_aliases
  for select to authenticated using (true);
create policy reference_projects_read on public.reference_projects
  for select to authenticated using (true);

create policy jobs_own on public.jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy job_parts_own on public.job_parts
  for select to authenticated using (user_id = (select auth.uid()));
create policy job_results_own on public.job_results
  for select to authenticated using (user_id = (select auth.uid()));
create policy inventory_items_own on public.inventory_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy usage_daily_own on public.usage_daily
  for select to authenticated using (user_id = (select auth.uid()));
create policy upload_tickets_own on public.upload_tickets
  for select to authenticated using (user_id = (select auth.uid()));
create policy result_cache_own on public.result_cache
  for select to authenticated using (user_id = (select auth.uid()));

-- Defence in depth: client roles never write directly, anon reads nothing.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from authenticated;
