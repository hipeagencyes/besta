-- =========================================================
-- BESTA · suite → composición colaborativa
-- =========================================================

create table if not exists public.composition_notebooks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default 'Idea nueva',
  status      text not null default 'idea'
              check (status in ('idea', 'writing', 'ready')),
  data        jsonb not null default '{"sections":[],"notes":""}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

create index if not exists composition_notebooks_updated_idx
  on public.composition_notebooks (updated_at desc);

create table if not exists public.composition_comments (
  id            uuid primary key default gen_random_uuid(),
  notebook_id   uuid not null references public.composition_notebooks(id) on delete cascade,
  section_id    text,
  body          text not null check (char_length(body) between 1 and 4000),
  created_by    uuid not null default auth.uid(),
  author_name   text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists composition_comments_notebook_idx
  on public.composition_comments (notebook_id, created_at);

alter table public.composition_comments replica identity full;

create or replace function public.composition_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists composition_notebooks_touch on public.composition_notebooks;
create trigger composition_notebooks_touch
  before update on public.composition_notebooks
  for each row execute function public.composition_touch();

alter table public.composition_notebooks enable row level security;
alter table public.composition_comments enable row level security;

drop policy if exists "composition_notebooks_auth" on public.composition_notebooks;
create policy "composition_notebooks_auth" on public.composition_notebooks
  for all to authenticated using (true) with check (true);

drop policy if exists "composition_comments_read" on public.composition_comments;
create policy "composition_comments_read" on public.composition_comments
  for select to authenticated using (true);

drop policy if exists "composition_comments_insert" on public.composition_comments;
create policy "composition_comments_insert" on public.composition_comments
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "composition_comments_delete_own" on public.composition_comments;
create policy "composition_comments_delete_own" on public.composition_comments
  for delete to authenticated using (created_by = auth.uid());

insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do nothing;

drop policy if exists "composition_audio_read" on storage.objects;
create policy "composition_audio_read" on storage.objects
  for select
  using (bucket_id = 'audio' and name like 'composition/%');

drop policy if exists "composition_audio_insert" on storage.objects;
create policy "composition_audio_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and name like 'composition/%');

drop policy if exists "composition_audio_update" on storage.objects;
create policy "composition_audio_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'audio' and name like 'composition/%')
  with check (bucket_id = 'audio' and name like 'composition/%');

drop policy if exists "composition_audio_delete" on storage.objects;
create policy "composition_audio_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and name like 'composition/%');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'composition_notebooks'
  ) then
    alter publication supabase_realtime add table public.composition_notebooks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'composition_comments'
  ) then
    alter publication supabase_realtime add table public.composition_comments;
  end if;
end;
$$;
