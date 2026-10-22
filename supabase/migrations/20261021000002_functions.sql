-- Server-side functions. Called only by the Worker (service role); execute is revoked
-- from client roles at the end of this file so PostgREST never exposes them.

-- Atomic: idempotency check → daily quota → insert job.
create function public.create_job(
  p_user uuid,
  p_client_request_id uuid,
  p_source text,
  p_goal text,
  p_photo_count int,
  p_limit int
) returns table (job_id uuid, duplicate boolean, allowed boolean, used int)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_day date := (now() at time zone 'utc')::date;
  v_job uuid;
  v_used int;
begin
  select j.id into v_job from public.jobs j
   where j.user_id = p_user and j.client_request_id = p_client_request_id;
  if v_job is not null then
    select coalesce(max(u.jobs), 0) into v_used from public.usage_daily u
     where u.user_id = p_user and u.day = v_day;
    return query select v_job, true, true, v_used;
    return;
  end if;

  if p_limit <= 0 then
    return query select null::uuid, false, false, 0;
    return;
  end if;

  insert into public.usage_daily as u (user_id, day, jobs) values (p_user, v_day, 1)
  on conflict (user_id, day) do update set jobs = u.jobs + 1 where u.jobs < p_limit
  returning u.jobs into v_used;

  if v_used is null then
    return query select null::uuid, false, false, p_limit;
    return;
  end if;

  insert into public.jobs (user_id, client_request_id, source, goal, photo_count)
  values (p_user, p_client_request_id, p_source, nullif(p_goal, ''), p_photo_count)
  on conflict (user_id, client_request_id) do nothing
  returning id into v_job;

  if v_job is null then
    -- Lost a race with a concurrent replay of the same request: refund, return winner.
    update public.usage_daily u set jobs = greatest(u.jobs - 1, 0)
     where u.user_id = p_user and u.day = v_day;
    select j.id into v_job from public.jobs j
     where j.user_id = p_user and j.client_request_id = p_client_request_id;
    return query select v_job, true, true, v_used - 1;
    return;
  end if;

  return query select v_job, false, true, v_used;
end;
$$;

-- Undo quota for a job that never reached the queue (upload/enqueue failure).
create function public.refund_job(p_job uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_day date;
begin
  update public.jobs set status = 'needs_review', stage = 'failed', error_code = 'internal'
   where id = p_job
   returning user_id, (created_at at time zone 'utc')::date into v_user, v_day;
  if v_user is not null then
    update public.usage_daily set jobs = greatest(jobs - 1, 0)
     where user_id = v_user and day = v_day;
  end if;
end;
$$;

create function public.quota_used(p_user uuid) returns int
language sql stable
set search_path = ''
as $$
  select coalesce(max(jobs), 0) from public.usage_daily
   where user_id = p_user and day = (now() at time zone 'utc')::date;
$$;

-- Upload tickets let queued offline uploads skip Turnstile (see docs/architecture.md, ADR-001).
create function public.issue_upload_tickets(p_user uuid, p_max int, p_ttl_s int)
returns setof public.upload_tickets
language plpgsql
set search_path = ''
as $$
declare
  v_active int;
begin
  delete from public.upload_tickets
   where user_id = p_user and (used_at is not null or expires_at <= now());
  select count(*) into v_active from public.upload_tickets where user_id = p_user;
  insert into public.upload_tickets (user_id, expires_at)
  select p_user, now() + make_interval(secs => p_ttl_s)
    from generate_series(1, greatest(p_max - v_active, 0));
  return query select * from public.upload_tickets
   where user_id = p_user order by created_at, id;
end;
$$;

create function public.consume_upload_ticket(p_user uuid, p_ticket uuid) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.upload_tickets set used_at = now()
   where id = p_ticket and user_id = p_user and used_at is null and expires_at > now()
   returning id into v_id;
  return v_id is not null;
end;
$$;

create function public.release_upload_ticket(p_user uuid, p_ticket uuid) returns void
language sql
set search_path = ''
as $$
  update public.upload_tickets set used_at = null
   where id = p_ticket and user_id = p_user and expires_at > now();
$$;

-- Hybrid catalog retrieval: nearest alias embeddings + trigram similarity on alias text.
-- Returns one row per part with its best signals; the matcher in packages/ai scores them.
create function public.match_catalog(
  p_embedding extensions.vector(768),
  p_query text,
  p_k int default 20
) returns table (part_id text, name text, has_profile boolean, alias text, vec_sim real, trgm_sim real)
language sql stable
set search_path = public, extensions
as $$
  with q as (select lower(coalesce(p_query, '')) as t),
  vec as (
    select a.part_id, a.alias, (1 - (a.embedding <=> p_embedding))::real as vec_sim, 0::real as trgm_sim
      from public.catalog_aliases a
     where p_embedding is not null and a.embedding is not null
     order by a.embedding <=> p_embedding
     limit p_k
  ),
  lex as (
    select a.part_id, a.alias, 0::real as vec_sim,
           greatest(similarity(a.alias_norm, q.t), word_similarity(a.alias_norm, q.t))::real as trgm_sim
      from public.catalog_aliases a, q
     where q.t <> '' and (a.alias_norm % q.t or a.alias_norm <% q.t)
     order by trgm_sim desc
     limit p_k
  ),
  hits as (select * from vec union all select * from lex),
  best as (
    select h.part_id,
           max(h.vec_sim) as vec_sim,
           max(h.trgm_sim) as trgm_sim,
           (array_agg(h.alias order by h.vec_sim + h.trgm_sim desc))[1] as alias
      from hits h group by h.part_id
  )
  select b.part_id, p.name, p.has_profile, b.alias, b.vec_sim, b.trgm_sim
    from best b join public.catalog_parts p on p.id = b.part_id
   order by greatest(b.vec_sim, b.trgm_sim) desc
   limit p_k;
$$;

-- Typeahead for the desktop "Add part" box.
create function public.search_catalog(p_query text, p_limit int default 10)
returns table (part_id text, name text, category text, has_profile boolean, score real)
language sql stable
set search_path = public, extensions
as $$
  with q as (select lower(trim(p_query)) as t)
  select p.id, p.name, p.category, p.has_profile,
         max(greatest(similarity(a.alias_norm, q.t), word_similarity(q.t, a.alias_norm),
                      case when strpos(a.alias_norm, q.t) > 0 then 0.9 else 0 end))::real as score
    from public.catalog_parts p
    join public.catalog_aliases a on a.part_id = p.id, q
   where q.t <> '' and (a.alias_norm % q.t or q.t <% a.alias_norm or strpos(a.alias_norm, q.t) > 0)
   group by p.id, p.name, p.category, p.has_profile
   order by p.has_profile desc, score desc, p.name
   limit least(greatest(p_limit, 1), 25);
$$;

create function public.match_reference_projects(p_embedding extensions.vector(768), p_k int default 4)
returns table (id text, title text, plan jsonb, similarity real)
language sql stable
set search_path = public, extensions
as $$
  select r.id, r.title, r.plan, (1 - (r.embedding <=> p_embedding))::real
    from public.reference_projects r
   where r.embedding is not null
   order by r.embedding <=> p_embedding
   limit p_k;
$$;

-- Applies a job's confirmed parts to the owner's inventory. Idempotent: each job_part
-- remembers what it already contributed, so re-confirming only applies the difference.
create function public.apply_job_inventory(p_job uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.jobs where id = p_job;
  if v_user is null then
    return;
  end if;

  create temporary table if not exists pg_temp.inv_delta (part_id text primary key, delta int not null)
    on commit drop;
  truncate pg_temp.inv_delta;

  -- remove previous contributions
  insert into pg_temp.inv_delta (part_id, delta)
  select jp.inventory_part_id, -sum(jp.inventory_applied)
    from public.job_parts jp
   where jp.job_id = p_job and jp.inventory_part_id is not null and jp.inventory_applied > 0
   group by jp.inventory_part_id
  on conflict (part_id) do update set delta = pg_temp.inv_delta.delta + excluded.delta;

  -- add current contributions
  insert into pg_temp.inv_delta (part_id, delta)
  select jp.part_id, sum(jp.quantity)
    from public.job_parts jp
   where jp.job_id = p_job and jp.part_id is not null and not jp.duplicate
     and jp.status in ('auto', 'confirmed', 'added')
   group by jp.part_id
  on conflict (part_id) do update set delta = pg_temp.inv_delta.delta + excluded.delta;

  update public.job_parts jp
     set inventory_part_id = case when jp.status in ('auto', 'confirmed', 'added') and not jp.duplicate
                                  then jp.part_id end,
         inventory_applied = case when jp.status in ('auto', 'confirmed', 'added') and not jp.duplicate
                                       and jp.part_id is not null
                                  then jp.quantity else 0 end
   where jp.job_id = p_job;

  -- existing rows take the delta (clamped at 0) ...
  update public.inventory_items i
     set quantity = greatest(i.quantity + d.delta, 0)
    from pg_temp.inv_delta d
   where i.user_id = v_user and i.part_id = d.part_id and d.delta <> 0;

  -- ... missing rows are created for positive deltas only
  insert into public.inventory_items as i (user_id, part_id, quantity)
  select v_user, d.part_id, d.delta from pg_temp.inv_delta d
   where d.delta > 0
     and not exists (select 1 from public.inventory_items x where x.user_id = v_user and x.part_id = d.part_id)
  on conflict (user_id, part_id) do update set quantity = i.quantity + excluded.quantity;

  delete from public.inventory_items where user_id = v_user and quantity = 0;
end;
$$;

-- Photo retention (30 days): the Worker cron lists, deletes from Storage, then marks.
create function public.jobs_with_expired_photos(p_days int, p_limit int)
returns table (id uuid, photo_paths text[])
language sql stable
set search_path = ''
as $$
  select j.id, j.photo_paths from public.jobs j
   where j.photos_deleted_at is null and j.photo_count > 0
     and j.created_at < now() - make_interval(days => p_days)
   order by j.created_at
   limit p_limit;
$$;

create function public.mark_photos_deleted(p_ids uuid[]) returns int
language sql
set search_path = ''
as $$
  with u as (
    update public.jobs set photos_deleted_at = now(), photo_paths = '{}'
     where id = any (p_ids) and photos_deleted_at is null
     returning 1
  ) select count(*)::int from u;
$$;

create function public.purge_result_cache(p_days int) returns int
language sql
set search_path = ''
as $$
  with d as (
    delete from public.result_cache where created_at < now() - make_interval(days => p_days) returning 1
  ) select count(*)::int from d;
$$;

-- Lock down: only the service role may call these.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end;
$$;
alter default privileges in schema public revoke execute on functions from public;
