-- =====================================================================
-- Configuración de Supabase Storage para los AUDIOS de los temas.
-- Ejecutar UNA sola vez en: Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- 1) Bucket público llamado "audio" (para poder reproducir con <audio src>)
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do update set public = true;

-- 2) Cualquiera puede LEER/reproducir los audios del bucket
drop policy if exists "audio public read" on storage.objects;
create policy "audio public read"
  on storage.objects for select
  using (bucket_id = 'audio');

-- 3) Solo usuarios autenticados (miembros logueados) pueden SUBIR
drop policy if exists "audio auth insert" on storage.objects;
create policy "audio auth insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'audio');

-- 4) ...y ACTUALIZAR
drop policy if exists "audio auth update" on storage.objects;
create policy "audio auth update"
  on storage.objects for update to authenticated
  using (bucket_id = 'audio');

-- 5) ...y BORRAR
drop policy if exists "audio auth delete" on storage.objects;
create policy "audio auth delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'audio');
