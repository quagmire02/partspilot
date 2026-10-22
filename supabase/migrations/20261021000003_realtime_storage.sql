-- Realtime: the desktop subscribes to its own jobs rows (RLS applies to postgres_changes).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs;
  end if;
end;
$$;

-- Private photo bucket: 10 MB cap, raster images only. No storage.objects policies are
-- created, so client roles cannot read or write objects; the Worker issues 5-minute
-- signed URLs with the service role.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;
