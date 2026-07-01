-- Corso — Phase 0: Storage-RLS für den Bucket 'moments'
-- Bezug: docs/ROADMAP.md Phase 0, Schritt 7.
--
-- Leitplanken:
--   🔒 Upload nur in eigenem Ordner ({user_id}/ als Pfad-Prefix)
--   🔒 Lesen: nur eingeloggte User (kein anonymer Public-Zugriff)
--   🔒 Löschen: nur eigene Objekte

alter table storage.objects enable row level security;

-- Upload: nur in den eigenen Unterordner (erster Pfad-Segment = user_id)
create policy "moments: upload own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'moments'
    and (storage.foldername(name))[1] = (auth.uid()::text)
  );

-- Lesen: alle eingeloggten User (Discovery-Feed braucht fremde Clips)
create policy "moments: read authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'moments');

-- Löschen: nur eigene Objekte
create policy "moments: delete own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'moments'
    and (storage.foldername(name))[1] = (auth.uid()::text)
  );
