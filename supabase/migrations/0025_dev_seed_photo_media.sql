-- Corso — Dev-Seed nutzt eigene Foto-Assets statt fremder Momente.
--
-- Vorher (0007): die synthetischen Test-Momente recycelten den media_path des
-- neuesten ECHTEN Posts — im Feed sah es aus, als hätten die Fake-Accounts den
-- Moment eines echten Users geklaut („cringe"); ohne lebenden echten Clip brach
-- das Seeden ab bzw. ältere Seeds zeigten leere Kacheln (dev-cs/…-Pfade ohne
-- Datei dahinter).
--
-- Jetzt: vier eigene Seed-Portraits liegen unter dev-seed/dev-moment-1…4.jpg im
-- Bucket `moments` (versioniert in supabase/seed/dev-moments/, Upload einmalig
-- via `node scripts/upload-dev-moments.mjs`). Die Kandidaten werden als
-- FOTO-Momente geseedet (0023) und rotieren durch die Bilder; jeder dritte
-- bekommt einen Foto-Stapel aus 2–3 Bildern, damit auch die Stapel-Darstellung
-- ohne echten Content testbar ist.
--
-- Signatur bleibt identisch → der Admin-Wrapper dev_menu_seed_test_clips (0006)
-- funktioniert unverändert; Aufräumen weiter über dev_clear_city_story_test()
-- (löscht die dev-cs-Konten per Cascade; die dev-seed-Dateien bleiben liegen
-- und werden beim nächsten Seed wiederverwendet).

create or replace function dev_seed_city_story(specs int[] default '{0,0,1,2,5,12,30,80}')
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  seed_photos constant text[] := array[
    'dev-seed/dev-moment-1.jpg',
    'dev-seed/dev-moment-2.jpg',
    'dev-seed/dev-moment-3.jpg',
    'dev-seed/dev-moment-4.jpg'
  ];
  spec int;
  idx int := 0;
  cand_id uuid;
  fol_id uuid;
  j int;
  suffix text;
  n_photos int;
  cand_paths text[];
  missing int;
begin
  -- Freundlicher Abbruch, falls die Seed-Fotos (noch) nicht hochgeladen sind —
  -- sonst gäbe es wieder leere Kacheln (signierte URL scheitert ohne Datei).
  select count(*) into missing
  from unnest(seed_photos) p
  where not exists (
    select 1 from storage.objects o where o.bucket_id = 'moments' and o.name = p
  );
  if missing > 0 then
    raise exception 'Es fehlen % Dev-Seed-Fotos im Bucket moments — einmal `node scripts/upload-dev-moments.mjs` ausführen.', missing;
  end if;

  foreach spec in array specs loop
    idx := idx + 1;
    suffix := to_char(now(), 'HH24MISS') || '-' || idx;

    -- Rotation durch die Seed-Fotos; jeder 3. Kandidat bekommt einen Stapel
    -- aus 2–3 aufeinanderfolgenden Bildern (testet die Foto-Stapel-Ansicht).
    n_photos := case when idx % 3 = 0 then 2 + (idx / 3) % 2 else 1 end;
    select array_agg(seed_photos[1 + ((idx - 1) + s) % array_length(seed_photos, 1)])
      into cand_paths
      from generate_series(0, n_photos - 1) s;

    cand_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', cand_id, 'authenticated',
              'authenticated', 'dev-cs-cand-' || suffix || '@corso.test', now(), now());
    insert into profiles (id, handle, city)
      values (cand_id, '@dev.cs' || idx || 'x' || (extract(epoch from now())::bigint % 100000), 'Düsseldorf');
    insert into posts (author_id, prompt_date, media_path, media_type, media_paths, city_story_consent)
      values (cand_id, corso_day(now()), cand_paths[1], 'photo', cand_paths, true);

    for j in 1..spec loop
      fol_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', fol_id, 'authenticated',
                'authenticated', 'dev-cs-fol-' || suffix || '-' || j || '@corso.test', now(), now());
      insert into profiles (id, handle, city)
        values (fol_id, '@dev.f' || idx || '_' || j || 'x' || (extract(epoch from now())::bigint % 100000), 'Düsseldorf');
      insert into follows (follower_id, followee_id, followed_at)
        values (fol_id, cand_id, now());
    end loop;
  end loop;

  return format('Seed ok: %s Kandidaten (Follower %s) mit eigenen Dev-Fotos (teils Stapel) → überall sichtbar.',
                array_length(specs, 1), specs::text);
end;
$$;

revoke all on function dev_seed_city_story(int[]) from public;
revoke execute on function dev_seed_city_story(int[]) from anon, authenticated;
