-- Corso — Phase 1: Stadt-Story-Ziehung (20:00 Europe/Berlin, stadtweit eingefroren)
-- Bezug: docs/PRD.md §4.6 (Stadt-Story = Herzstück), docs/ROADMAP.md Phase 1.
--
-- Leitplanken, die hier serverseitig erzwungen werden:
--   🔒 Nur einwilligungs-markierte Clips (posts.city_story_consent) kommen in die Ziehung.
--   🔒 Gewichtete ZUFALLSziehung mit Grundchance > 0 für jeden Kandidaten — keine Rangliste.
--   🔒 Die private Follower-Zahl fließt NUR serverseitig ins Gewicht (SECURITY DEFINER,
--      inline gezählt) und wird NIE als Zahl zurückgegeben → kein Leak an den Client.
--   🔒 Stadtweit identische, über den Tag eingefrorene Auswahl (city_story_slots).
--
-- Entscheidungen (mit Maxim/Dominik abgestimmt):
--   - Dünner Pool: Story läuft IMMER mit so vielen Clips wie einwilligend da sind
--     (auch 1–2), kein Mindest-Schwellwert.
--   - Moderation: im Freundes-Pilot kein Sperr-/Melde-Modell — Filter ist nur
--     Consent + heutiger Corso-Tag + Stadt.
--
-- Zeitzone: pg_cron läuft in UTC. 20:00 Berlin = 18:00 UTC (Sommer/CEST) bzw.
--   19:00 UTC (Winter/CET). Deshalb feuern ZWEI Cron-Jobs (18:00 + 19:00 UTC),
--   die Ziehungsfunktion prüft aber selbst, ob es gerade 20 Uhr Berliner Zeit ist,
--   und no-opt sonst. Die jeweils "falsche" Stunde läuft dank Idempotenz leer durch.

-- ---------------------------------------------------------------------------
-- 1. city_story_slots: Stadt-Spalte für Mehr-Städte-Zukunftssicherheit (§d)
--    Pilot füllt real nur 'Düsseldorf', aber das Modell ist pro Stadt.
-- ---------------------------------------------------------------------------
alter table city_story_slots add column if not exists city text not null default 'Düsseldorf';

-- Alte, stadt-blinde Unique-Constraints ersetzen (zwei Städte dürfen denselben Slot belegen).
alter table city_story_slots drop constraint if exists city_story_slots_story_date_slot_key;
alter table city_story_slots drop constraint if exists city_story_slots_story_date_post_id_key;
alter table city_story_slots add constraint city_story_slots_day_city_slot_key unique (story_date, city, slot);
alter table city_story_slots add constraint city_story_slots_day_city_post_key unique (story_date, city, post_id);

-- ---------------------------------------------------------------------------
-- 2. draw_city_story(city, force) — die gewichtete Zufallsziehung, serverseitig.
--
--    Gewicht je Kandidat:  w = 1 + ln(1 + aktive_follower)
--      - Neuling (0 Follower): w = 1 + ln(1) = 1.0  → reale, spürbare Grundchance.
--      - 50 Follower:          w = 1 + ln(51) ≈ 4.9  → gedämpft (log = abnehmender
--        Grenznutzen), kein Erdrutsch, verdrängbar durch Neulinge.
--    Ziehung ohne Zurücklegen (Efraimidis-Spirakis): pro Kandidat
--      schlüssel = random()^(1/w); die 8 größten Schlüssel gewinnen.
--    Die Follower-Zahl wird INLINE gezählt und nie zurückgegeben (kein Leak).
--
--    force=false: idempotent — existiert die Auswahl für (Tag, Stadt) schon,
--                 passiert nichts (deckt "Cron doppelt gelaufen" ab).
--    force=true : bestehende Auswahl für (Tag, Stadt) wird neu gezogen (Test).
--    Rückgabe: Anzahl gesetzter Slots.
-- ---------------------------------------------------------------------------
create or replace function draw_city_story(target_city text, force boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := corso_day(now());
  inserted integer;
begin
  if force then
    delete from city_story_slots where story_date = d and city = target_city;
  elsif exists (select 1 from city_story_slots where story_date = d and city = target_city) then
    return 0;  -- schon gezogen → eingefroren lassen
  end if;

  with cand as (
    select
      p.id as post_id,
      -- 🔒 Follower-Zahl nur intern fürs Gewicht, verlässt die Funktion nie:
      (select count(*) from follows f
        where f.followee_id = p.author_id and f.expires_at is null) as followers
    from posts p
    join profiles pr on pr.id = p.author_id
    where p.prompt_date = d
      and p.city_story_consent = true       -- 🔒 nur Einwilligung
      and pr.city = target_city
  ),
  keyed as (
    select post_id,
           power(random(), 1.0 / (1 + ln(1 + followers))) as k
    from cand
  ),
  picked as (
    select post_id, (row_number() over (order by k desc) - 1)::smallint as slot
    from keyed
    order by k desc
    limit 8
  )
  insert into city_story_slots (story_date, city, post_id, slot)
  select d, target_city, post_id, slot from picked;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function draw_city_story(text, boolean) from public;

-- ---------------------------------------------------------------------------
-- 3. run_city_story_draw() — Cron-Einstieg. Prüft "ist es 20 Uhr Berlin?",
--    zieht dann für JEDE Stadt (real nur Düsseldorf). No-op außerhalb 20 Uhr.
-- ---------------------------------------------------------------------------
create or replace function run_city_story_draw()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c text;
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 20 then
    return;  -- die "falsche" Cron-Stunde (DST) läuft leer durch
  end if;
  for c in select distinct city from profiles loop
    perform draw_city_story(c, false);
  end loop;
end;
$$;

revoke all on function run_city_story_draw() from public;

-- ---------------------------------------------------------------------------
-- 4. pg_cron — zwei UTC-Slots, die Funktion no-opt in der falschen Stunde.
--    cron.schedule() ist per Job-Name ein Upsert (idempotent bei Re-Run).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule('city-story-draw-summer', '0 18 * * *', 'select public.run_city_story_draw()');
select cron.schedule('city-story-draw-winter', '0 19 * * *', 'select public.run_city_story_draw()');

-- ===========================================================================
-- DEV/TEST-Werkzeuge — NICHT für Produktion. Klar als dev_ markiert (Konvention
-- wie dev_expire_my_follows). Legen synthetische Test-User/-Posts/-Follows an,
-- damit die Gewichtung verifizierbar ist, ohne bis 20:00 zu warten.
-- Aufräumen jederzeit mit dev_clear_city_story_test().
-- ===========================================================================

-- dev_seed_city_story(specs) — je Wert in specs ein Kandidat mit exakt so vielen
-- aktiven Followern (Default deckt 2 Neulinge mit 0 Followern + gedämpfte Spitze ab).
-- Alle synthetischen Konten haben E-Mail 'dev-cs-...@corso.test'.
create or replace function dev_seed_city_story(specs int[] default '{0,0,1,3,8,20,55}')
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
begin
  foreach spec in array specs loop
    idx := idx + 1;
    suffix := to_char(now(), 'HH24MISS') || '-' || idx;

    -- Kandidat: auth.user + profile + heutiger einwilligender Post
    cand_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', cand_id, 'authenticated',
              'authenticated', 'dev-cs-cand-' || suffix || '@corso.test', now(), now());
    insert into profiles (id, handle, city)
      values (cand_id, '@dev.cs' || idx || 'x' || (extract(epoch from now())::bigint % 100000), 'Düsseldorf');
    insert into posts (author_id, prompt_date, media_path, media_type, city_story_consent)
      values (cand_id, corso_day(now()), 'dev-cs/' || cand_id || '.mp4', 'video', true);

    -- spec aktive Follower für diesen Kandidaten anlegen
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

  return format('Seed ok: %s Kandidaten mit Follower-Zahlen %s angelegt (heute, Düsseldorf, consent=true).',
                array_length(specs, 1), specs::text);
end;
$$;

revoke all on function dev_seed_city_story(int[]) from public;

-- dev_clear_city_story_test() — alle synthetischen Test-Konten (und per Cascade
-- deren Posts/Follows/Slots) wieder entfernen.
create or replace function dev_clear_city_story_test()
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare n int;
begin
  delete from auth.users where email like 'dev-cs-%@corso.test';
  get diagnostics n = row_count;
  return format('%s synthetische Test-Konten entfernt (Posts/Follows/Slots per Cascade).', n);
end;
$$;

revoke all on function dev_clear_city_story_test() from public;
