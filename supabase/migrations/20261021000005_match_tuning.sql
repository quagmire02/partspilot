-- Lexical scoring fix found on the local stack: word_similarity(alias, query) gives a
-- one-word alias ("BATTERY", "Bluetooth") a perfect 1.0 whenever the query contains it,
-- crowding specific aliases out of the top-k. Scale containment scores by relative length.

create or replace function public.alias_text_score(p_alias text, p_query text) returns real
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select greatest(
    similarity(p_alias, p_query),
    word_similarity(p_alias, p_query) * least(1.0, char_length(p_alias)::real / greatest(char_length(p_query) * 0.5, 1)),
    word_similarity(p_query, p_alias) * least(1.0, char_length(p_query)::real / greatest(char_length(p_alias) * 0.5, 1))
  )::real;
$$;

create or replace function public.match_catalog(
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
    select a.part_id, a.alias, 0::real as vec_sim, public.alias_text_score(a.alias_norm, q.t) as trgm_sim
      from public.catalog_aliases a, q
     where q.t <> '' and (a.alias_norm % q.t or a.alias_norm <% q.t or q.t <% a.alias_norm)
     order by public.alias_text_score(a.alias_norm, q.t) desc
     limit p_k * 2
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
   order by greatest(b.vec_sim, b.trgm_sim) desc, p.has_profile desc
   limit p_k;
$$;

revoke execute on function public.alias_text_score(text, text) from public;
revoke execute on function public.match_catalog(extensions.vector, text, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.alias_text_score(text, text) from anon, authenticated;
    revoke execute on function public.match_catalog(extensions.vector, text, int) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.alias_text_score(text, text) to service_role;
    grant execute on function public.match_catalog(extensions.vector, text, int) to service_role;
  end if;
end;
$$;
