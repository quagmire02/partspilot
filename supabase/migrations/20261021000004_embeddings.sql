-- Bulk embedding writes for the data sync script (service role only).

create function public.set_alias_embeddings(p_rows jsonb) returns int
language sql
set search_path = public, extensions
as $$
  with src as (
    select (r ->> 'id')::bigint as id, (r ->> 'embedding')::extensions.vector(768) as embedding
      from jsonb_array_elements(p_rows) r
  ), u as (
    update public.catalog_aliases a set embedding = s.embedding from src s where a.id = s.id returning 1
  ) select count(*)::int from u;
$$;

create function public.set_reference_embeddings(p_rows jsonb) returns int
language sql
set search_path = public, extensions
as $$
  with src as (
    select r ->> 'id' as id, (r ->> 'embedding')::extensions.vector(768) as embedding
      from jsonb_array_elements(p_rows) r
  ), u as (
    update public.reference_projects p set embedding = s.embedding, updated_at = now() from src s where p.id = s.id returning 1
  ) select count(*)::int from u;
$$;

revoke execute on function public.set_alias_embeddings(jsonb) from public;
revoke execute on function public.set_reference_embeddings(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.set_alias_embeddings(jsonb) from anon, authenticated;
    revoke execute on function public.set_reference_embeddings(jsonb) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_alias_embeddings(jsonb) to service_role;
    grant execute on function public.set_reference_embeddings(jsonb) to service_role;
  end if;
end;
$$;
