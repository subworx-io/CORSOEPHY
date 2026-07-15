-- Corso — Fix: Dev-Seed-Clips müssen eine ECHTE Storage-Datei referenzieren,
-- sonst filtert das Frontend sie raus (signierte URL scheitert bei fehlender Datei)
-- und nur echte Clips bleiben in der Story sichtbar.
--
-- Lösung: die synthetischen Posts übernehmen den media_path eines bereits
-- existierenden echten Clips (neuester Nicht-Dev-Post). Alle Fake-Clips spielen
-- dann dasselbe reale Video ab, tragen aber unterschiedliche Handles + Follower-
-- Gewichte → gewichtete Ziehung wird sichtbar testbar.

create or replace function dev_seed_city_story(specs int[] default '{0,0,1,2,5,12,30,80}')
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  spec int;
  idx int := 0;
  cand_id uuid;
  fol_id uuid;
  j int;
  suffix text;
  real_media text;
begin
  -- Echten, existierenden Clip-Pfad wiederverwenden, damit die Fake-Clips rendern.
  select media_path into real_media
  from posts
  where media_path not like 'dev-cs/%'
  order by created_at desc
  limit 1;

  if real_media is null then
    raise exception 'Kein echter Clip vorhanden — bitte zuerst einen Moment aufnehmen/hochladen, dann seeden.';
  end if;

  foreach spec in array specs loop
    idx := idx + 1;
    suffix := to_char(now(), 'HH24MISS') || '-' || idx;

    cand_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', cand_id, 'authenticated',
              'authenticated', 'dev-cs-cand-' || suffix || '@corso.test', now(), now());
    insert into profiles (id, handle, city)
      values (cand_id, '@dev.cs' || idx || 'x' || (extract(epoch from now())::bigint % 100000), 'Düsseldorf');
    -- 🔑 echter media_path statt dev-cs/… → Clip ist im Frontend sichtbar
    insert into posts (author_id, prompt_date, media_path, media_type, city_story_consent)
      values (cand_id, corso_day(now()), real_media, 'video', true);

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

  return format('Seed ok: %s Kandidaten (Follower %s), alle mit echtem Clip-Pfad → in der Story sichtbar.',
                array_length(specs, 1), specs::text);
end;
$$;

revoke all on function dev_seed_city_story(int[]) from public;
revoke execute on function dev_seed_city_story(int[]) from anon, authenticated;

-- Wrapper an die neue (leichtere) Default-Spec angleichen.
create or replace function dev_menu_seed_test_clips()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  return dev_seed_city_story();  -- neue Default-Spec {0,0,1,2,5,12,30,80}
end;
$$;
revoke all on function dev_menu_seed_test_clips() from public;
grant execute on function dev_menu_seed_test_clips() to authenticated;
