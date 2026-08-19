-- Corso — 0015: Rollender 24h-Verfall pro Datensatz + Zyklus-Wechsel auf 21:00
-- Bezug: docs/PRD.md §4.1/§4.3/§4.9, docs/STATUS.md. Abgestimmt mit Dominik (19. Aug 2026).
--
-- WAS SICH KONZEPTUELL ÄNDERT
--   Vorher: die ganze Stadt startete gemeinsam bei null. Um 08:00 verfielen ALLE
--   Follows (Cron), die Discovery war leer, ein neuer Prompt kam. Verfall war ein
--   stadtweites Ereignis.
--   Jetzt:  jeder Datensatz trägt seinen EIGENEN Ablaufzeitpunkt (created_at + 24h).
--   Ein Follow von Montag 14:00 stirbt Dienstag 14:00 — unabhängig von jedem Reset.
--   Verfall ist damit individuell und asynchron; jeder Nutzer hat seine eigene Uhr.
--
--   Der TAGES-Begriff (corso_day) bleibt bestehen, wandert aber von 08:00 auf 21:00:
--   der neue Prompt startet gemeinsam mit der Stadt-Story-Ziehung. Ein Zyklus läuft
--   21:00 → 21:00 (Europe/Berlin) und trägt weiterhin Prompt-Historie, story_date,
--   Anstups-Limit und Snapshot-Basis.
--
-- WIE VERFALL GERECHNET WIRD
--   Ausschließlich über `expires_at > now()` in Queries und Funktionen — KEIN
--   Markier-Cron. Ein Cron (auch minütlich) hätte ein Lag-Fenster, in dem die DB
--   tote Momente noch als lebend ausliefert; bei individuellen Timern wäre das ein
--   Dauerzustand. `expires_at` IST die Markierung.
--   🔒 Nichts wird gelöscht. Abgelaufene Rows bleiben vollständig erhalten und sind
--      für Pilot-Metriken auswertbar (man sieht exakt, wann was gestorben ist).
--
-- 🔒 LEITPLANKEN, die hier strukturell durchgesetzt werden
--   - Verfall ist NICHT verlängerbar: expires_at wird per BEFORE-Trigger serverseitig
--     erzwungen. Ein Client kann seine Zeile zwar updaten (posts_update_self /
--     follows_update_own), den Ablauf aber nur VORZIEHEN, nie hinausschieben.
--   - Follower-Zahlen bleiben privat: my_reach()/my_feedback() bleiben argumentlos
--     und SECURITY DEFINER; hier ändert sich NUR der Aktiv-Filter.
--   - `connections` (Dating-Anbahnung) wird nicht angefasst. Verfall betrifft
--     ausschließlich Follows und Momente.

-- ===========================================================================
-- 1. corso_day(): Zyklus-Grenze 08:00 → 21:00
-- ===========================================================================
-- ts vor 21:00 Berlin gehört noch zum Vor-Zyklus. Wir verschieben um 21h zurück
-- und nehmen das Datum in Berliner Zeit. Die Signatur bleibt gleich, damit alle
-- Spalten-Defaults (posts.prompt_date, nudges.nudge_date, city_story_slots.story_date,
-- reach_snapshots.snapshot_date) unverändert weiter funktionieren.
create or replace function corso_day(ts timestamptz default now())
returns date
language sql
immutable
as $$
  select ((ts at time zone 'Europe/Berlin') - interval '21 hours')::date
$$;

-- ===========================================================================
-- 2. posts.expires_at — die Lebensuhr des Moments
-- ===========================================================================
alter table posts add column if not exists expires_at timestamptz;

-- Backfill: Bestandsmomente bekommen rückwirkend ihre 24h ab Post. Alles, was
-- älter als 24h ist, ist damit sofort korrekt abgelaufen (nicht gelöscht).
update posts set expires_at = created_at + interval '24 hours' where expires_at is null;

alter table posts alter column expires_at set not null;
alter table posts alter column expires_at set default (now() + interval '24 hours');

-- Discovery liest „lebende Momente, neueste zuerst"; der Rücklauf „mein lebender Moment".
create index if not exists posts_expires_created_idx on posts (expires_at, created_at desc);
create index if not exists posts_author_expires_idx  on posts (author_id, expires_at);

-- ===========================================================================
-- 3. follows.expires_at — Bedeutungswechsel der bestehenden Spalte
-- ===========================================================================
-- ACHTUNG, das ist eine Semantik-Kippe:
--   ALT: NULL = aktiv, Zeitstempel = bereits verfallen (0003_follows_expiry.sql)
--   NEU: Zeitstempel in der ZUKUNFT = aktiv, in der Vergangenheit = verfallen
-- Bereits verfallene Rows sind kompatibel (ihr Stempel liegt in der Vergangenheit).
-- Alle Aktiv-Filter (`is null` → `> now()`) werden in Schritt 7–9 mitgezogen; wer
-- hier eine Stelle vergisst, sieht ab sofort NULL aktive Follows.
update follows set expires_at = followed_at + interval '24 hours' where expires_at is null;

alter table follows alter column expires_at set not null;
alter table follows alter column expires_at set default (now() + interval '24 hours');

-- Der alte partielle Index (`where expires_at is null`) trifft nach der Kippe nie
-- mehr zu und würde nur noch Schreiblast erzeugen.
drop index if exists follows_active_followee_idx;
create index if not exists follows_followee_expires_idx on follows (followee_id, expires_at);
create index if not exists follows_follower_expires_idx on follows (follower_id, expires_at);

-- ===========================================================================
-- 4. Trigger: expires_at ist serverseitig erzwungen, nie clientseitig gesetzt
-- ===========================================================================
-- Warum zwingend: `posts_update_self` und `follows_update_own` (0001_init.sql)
-- erlauben dem Nutzer, seine eigene Zeile zu ändern. Solange NULL „aktiv" hieß,
-- war das harmlos. Mit einem Zukunfts-Zeitstempel könnte ein präparierter Client
-- `expires_at = now() + 10 years` schreiben → Moment lebt ewig, Publikum verfällt
-- nie. Das verletzt zwei 🔒 Leitplanken. Die Trigger schließen das:
-- VORZIEHEN ist erlaubt (Moment vorzeitig beenden / entfolgen), VERLÄNGERN nie.

create or replace function enforce_post_expiry()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- created_at kommt von der DB, nicht vom Client (sonst wäre die Uhr manipulierbar).
    new.created_at := now();
    new.expires_at := new.created_at + interval '24 hours';
  else
    if new.media_path is distinct from old.media_path then
      -- Neuer Clip auf derselben Zeile (Re-Post im selben Zyklus über den Upsert):
      -- Das ist ein NEUER Moment → die Uhr startet neu.
      new.created_at := now();
      new.expires_at := new.created_at + interval '24 hours';
    else
      -- Sonstiges Update (z.B. Consent-Umschalten): Uhr bleibt, wie sie war.
      -- least() lässt Vorziehen zu (Moment beenden), Verlängern nicht.
      new.created_at := old.created_at;
      new.expires_at := least(
        coalesce(new.expires_at, old.expires_at),
        old.created_at + interval '24 hours'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_enforce_expiry on posts;
create trigger posts_enforce_expiry
  before insert or update on posts
  for each row execute function enforce_post_expiry();

-- Genau EIN lebender Moment pro Person (Abstimmung 19. Aug): ein neuer Post
-- beendet den bisherigen sofort. Ohne das könnten sich zwei Momente überlappen
-- (Post 23:00 + Post 09:00) und dieselbe Person stünde zweimal in der Discovery.
create or replace function expire_previous_moment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update posts
  set expires_at = now()
  where author_id = new.author_id
    and id <> new.id
    and expires_at > now();
  return null;
end;
$$;

drop trigger if exists posts_single_living on posts;
create trigger posts_single_living
  after insert on posts
  for each row execute function expire_previous_moment();

create or replace function enforce_follow_expiry()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.followed_at := now();
    new.expires_at  := new.followed_at + interval '24 hours';
  elsif new.followed_at is distinct from old.followed_at then
    -- Erneuern. Nur erlaubt, wenn der laufende Follow schon ≥ 12h alt ist
    -- (PRD-Nachfolge der „kein Doppel-Follow am selben Tag"-Regel). Sonst könnte
    -- man durch Dauer-Tippen ein unbefristetes Publikum halten → 🔒 Umgehung.
    -- Ein bereits ABGELAUFENER Follow darf jederzeit neu begonnen werden; sonst
    -- wäre man nach einem versehentlichen Entfolgen 12h ausgesperrt.
    if old.expires_at > now() and old.followed_at > now() - interval '12 hours' then
      new.followed_at := old.followed_at;
      new.expires_at  := old.expires_at;
    else
      new.followed_at := now();
      new.expires_at  := new.followed_at + interval '24 hours';
    end if;
  else
    -- Entfolgen (expires_at = now()) und alles andere: Vorziehen ja, Verlängern nein.
    new.expires_at := least(
      coalesce(new.expires_at, old.expires_at),
      old.followed_at + interval '24 hours'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists follows_enforce_expiry on follows;
create trigger follows_enforce_expiry
  before insert or update on follows
  for each row execute function enforce_follow_expiry();

-- ===========================================================================
-- 5. RLS: abgelaufene Momente sind serverseitig weg — auch für den Autor
-- ===========================================================================
-- Die Ephemeralität ist eine Produkt-Leitplanke, keine Client-Konvention: ohne
-- diese Policy könnte jeder Eingeloggte per API alle je geposteten Momente lesen.
-- Hinweis: Die Mediendatei im Bucket 'moments' bleibt liegen (storage-RLS aus
-- 0002 erlaubt Lesen für alle Eingeloggten). Das ist für die eingefrorene
-- Stadt-Story (Schritt 6) nötig und entspricht dem „nicht löschen"-Prinzip.
drop policy if exists posts_read_all on posts;
create policy posts_read_living on posts
  for select to authenticated
  using (expires_at > now());

-- ===========================================================================
-- 6. city_story() — die eingefrorene Stadt-Story überlebt den Verfall
-- ===========================================================================
-- Entscheidung 19. Aug: Wer gezogen wird, bleibt die ganze Story lang sichtbar,
-- auch wenn seine 24h in Discovery/Ich-folge/Rücklauf ablaufen. Das Rampenlicht
-- verlängert den Moment (max. ~48h, wenn ein knapp 24h alter Clip gezogen wird).
-- Weil Schritt 5 abgelaufene Posts per RLS ausblendet, braucht die Story einen
-- eigenen Lesepfad: SECURITY DEFINER, streng auf die eingefrorenen Slots des
-- laufenden Zyklus begrenzt.
-- 🔒 Gibt ausschließlich Anzeige-Daten zurück — keine Follower-/Reaktions-Zahlen.
create or replace function city_story(target_city text default null)
returns table (
  slot        smallint,
  handle      text,
  media_path  text,
  post_id     uuid,
  prompt_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select s.slot, pr.handle, p.media_path, p.id, p.prompt_date
  from city_story_slots s
  join posts p    on p.id = s.post_id
  join profiles pr on pr.id = p.author_id
  where auth.uid() is not null
    and s.story_date = corso_day(now())
    and s.city = coalesce(
      target_city,
      (select city from profiles where id = auth.uid()),
      'Düsseldorf'
    )
  order by s.slot
$$;

revoke all on function city_story(text) from public;
revoke all on function city_story(text) from anon;
grant execute on function city_story(text) to authenticated;

-- ===========================================================================
-- 7. Stadt-Story-Ziehung: Kandidaten = alles, was noch lebt; Uhrzeit 21:00
-- ===========================================================================
-- Kandidatenfenster ist jetzt der rollende 24h-Topf (`expires_at > now()`) statt
-- „Posts des heutigen Corso-Tags". Nebeneffekt der 24h-Regel: ein Moment kann
-- höchstens von EINER Ziehung gesehen werden (Ziehungen liegen 24h auseinander).
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
        where f.followee_id = p.author_id and f.expires_at > now()) as followers
    from posts p
    join profiles pr on pr.id = p.author_id
    where p.expires_at > now()                -- lebende Momente (rollende 24h)
      and p.city_story_consent = true         -- 🔒 nur Einwilligung
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
revoke execute on function draw_city_story(text, boolean) from anon, authenticated;

-- 21:00 statt 20:00. Die Selbstprüfung der Stunde bleibt der DST-Anker: pg_cron
-- kennt keine Zeitzonen, die Funktion schon.
create or replace function run_city_story_draw()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c text;
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 21 then
    return;  -- die "falsche" Cron-Stunde (DST) läuft leer durch
  end if;
  for c in select distinct city from profiles loop
    perform draw_city_story(c, false);
  end loop;
end;
$$;

revoke all on function run_city_story_draw() from public;
revoke execute on function run_city_story_draw() from anon, authenticated;

-- ===========================================================================
-- 8. Kennzahlen: Aktiv-Filter auf die neue Semantik
--    🔒 Signaturen unverändert: argumentlos, SECURITY DEFINER, an auth.uid() gepinnt.
-- ===========================================================================

-- „Der Moment, der gerade für andere sichtbar ist": normalerweise der lebende,
-- zusätzlich aber der im laufenden Stadt Corso eingefrorene. Ohne den Zusatz
-- zeigte der Rücklauf 0 Zuschauer, während die ganze Stadt den Clip im Corso
-- sieht (passiert bei jedem Moment, der kurz nach der Ziehung 24h alt wird).
-- Intern, kein Client-Grant: gibt eine fremde post_id nur an DEFINER-Aufrufer.
create or replace function latest_visible_post(target_user uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select p.id
  from posts p
  where p.author_id = target_user
    and (
      p.expires_at > now()
      or exists (
        select 1 from city_story_slots s
        where s.post_id = p.id and s.story_date = corso_day(now())
      )
    )
  order by p.created_at desc
  limit 1
$$;

revoke all on function latest_visible_post(uuid) from public;
revoke execute on function latest_visible_post(uuid) from anon, authenticated;
create or replace function my_reach()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select case
    when auth.uid() is null then 0
    else (
      select count(*)::int
      from follows
      where followee_id = auth.uid()
        and expires_at > now()
    )
  end
$$;

revoke all on function my_reach() from public;
revoke all on function my_reach() from anon;
grant execute on function my_reach() to authenticated;

create or replace function my_feedback()
returns table (
  publikum        integer,
  publikum_delta  integer,
  zuschauer       integer,
  zuschauer_delta integer,
  has_yesterday   boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid          uuid := auth.uid();
  latest_post  uuid;
  pub          integer;
  zus          integer;
  snap_follow  integer;
  snap_view    integer;
begin
  if uid is null then
    return query select 0, null::integer, 0, null::integer, false;
    return;
  end if;

  -- Publikum: aktive Follower (identisch zu my_reach).
  select count(*)::integer into pub
  from follows
  where followee_id = uid and expires_at > now();

  -- Zuschauer: eindeutige Betrachter des Moments, der gerade sichtbar ist
  -- (lebend ODER im laufenden Stadt Corso eingefroren). Ist gar keiner sichtbar,
  -- gibt es nichts zu messen → 0.
  latest_post := latest_visible_post(uid);

  if latest_post is null then
    zus := 0;
  else
    select count(*)::integer into zus
    from post_views
    where post_id = latest_post;
  end if;

  -- Gestern: jüngster Snapshot vor dem laufenden Zyklus.
  select follower_count, pool_viewers into snap_follow, snap_view
  from reach_snapshots
  where user_id = uid and snapshot_date < corso_day(now())
  order by snapshot_date desc
  limit 1;

  if not found then
    return query select pub, null::integer, zus, null::integer, false;
  else
    return query select pub, (pub - snap_follow), zus, (zus - snap_view), true;
  end if;
end;
$$;

revoke all on function my_feedback() from public;
revoke all on function my_feedback() from anon;
grant execute on function my_feedback() to authenticated;

-- Basislinie für die „seit gestern"-Deltas. Läuft jetzt zum Zyklus-Start (21:05),
-- nicht mehr morgens — sonst läge die Messung mitten im Zyklus.
create or replace function snapshot_reach()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := corso_day(now());
begin
  insert into reach_snapshots (user_id, snapshot_date, follower_count, pool_viewers)
  select
    pr.id,
    d,
    (select count(*)::integer from follows f
       where f.followee_id = pr.id and f.expires_at > now()),
    coalesce((
      select count(*)::integer from post_views v
      where v.post_id = latest_visible_post(pr.id)
    ), 0)
  from profiles pr
  on conflict (user_id, snapshot_date) do update
    set follower_count = excluded.follower_count,
        pool_viewers   = excluded.pool_viewers;
end;
$$;

revoke all on function snapshot_reach() from public;
revoke all on function snapshot_reach() from anon;

-- Gleicher DST-Trick wie bei der Ziehung: zwei UTC-Slots, Stunden-Guard innen.
create or replace function run_reach_snapshot()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 21 then
    return;
  end if;
  perform snapshot_reach();
end;
$$;

revoke all on function run_reach_snapshot() from public;
revoke execute on function run_reach_snapshot() from anon, authenticated;

-- ===========================================================================
-- 9. Der Verfalls-Cron fällt weg
-- ===========================================================================
-- expire_follows() war der Motor des stadtweiten 08:00-Resets (Zwei-Reset-Regel).
-- Mit `expires_at > now()` in jeder Query gibt es nichts mehr zu markieren.
select cron.unschedule(jobid) from cron.job where jobname = 'expire-follows-daily';
drop function if exists expire_follows();

-- ===========================================================================
-- 10. Cron-Fahrplan auf 21:00 Berlin
--     21:00 Berlin = 19:00 UTC (Sommer/CEST) bzw. 20:00 UTC (Winter/CET).
--     Beide Slots feuern täglich, die Stunden-Guards lassen den falschen leerlaufen.
-- ===========================================================================
select cron.unschedule(jobid) from cron.job
  where jobname in ('city-story-draw-summer', 'city-story-draw-winter', 'reach-snapshot-daily');

select cron.schedule('city-story-draw-summer', '0 19 * * *', 'select public.run_city_story_draw()');
select cron.schedule('city-story-draw-winter', '0 20 * * *', 'select public.run_city_story_draw()');
select cron.schedule('reach-snapshot-summer',  '5 19 * * *', 'select public.run_reach_snapshot()');
select cron.schedule('reach-snapshot-winter',  '5 20 * * *', 'select public.run_reach_snapshot()');

-- ===========================================================================
-- 11. Dev-Menü: Texte richtigstellen + Moment-Verfall testbar machen
-- ===========================================================================
create or replace function dev_menu_expire_my_follows()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  update follows set expires_at = now()
    where follower_id = auth.uid() and expires_at > now();
  get diagnostics n = row_count;
  return format('%s deiner Follows sofort ablaufen lassen (24h-Verfall vorgezogen).', n);
end $$;
revoke all on function dev_menu_expire_my_follows() from public;
grant execute on function dev_menu_expire_my_follows() to authenticated;

-- Ohne das müsste man 24h warten, um den Moment-Verfall auf dem Handy zu sehen.
create or replace function dev_menu_expire_my_moment()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  update posts set expires_at = now()
    where author_id = auth.uid() and expires_at > now();
  get diagnostics n = row_count;
  if n = 0 then
    return 'Du hast gerade keinen lebenden Moment.';
  end if;
  return format('%s Moment sofort ablaufen lassen — er ist jetzt überall weg (24h vorgezogen).', n);
end $$;
revoke all on function dev_menu_expire_my_moment() from public;
grant execute on function dev_menu_expire_my_moment() to authenticated;
