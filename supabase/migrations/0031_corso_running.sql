-- Corso — 0031: Der LAUFENDE Corso (löst die 21:00-Ziehung ab)
-- Auftrag Dominik, 9. Sep 2026, als Eigner-Entscheidung freigegeben.
-- Bezug: docs/PRD.md §4.6 (wird auf v0.6 nachgezogen), docs/STATUS.md.
--
-- WAS SICH KONZEPTUELL ÄNDERT
--   Vorher: einmal täglich um 21:00 zog `draw_city_story()` bis zu 8 Momente und
--   fror sie für 24 h ein. Ein vorhersehbarer Reset, dazwischen Stillstand.
--   Jetzt:  der Corso hat eine feste Zahl SLOTS (Start 10, über app_config
--   skalierbar). Jede Belegung endet exakt dann, wenn ihr Moment seine 24 h
--   erreicht — dann wird der Slot frei und ein Cron-Lauf (jede Minute) rückt
--   den nächsten passenden Moment nach. Der Corso ist damit immer voll und
--   jederzeit aktuell; es gibt keinen Reset und keinen Leerlauf mehr.
--
-- DIE REGELN, DIE HIER SERVERSEITIG ERZWUNGEN WERDEN
--   🔒 Nur einwilligende Momente (posts.city_story_consent) sind Kandidaten.
--   🔒 Die Follower-Zahl fließt NUR intern ins Gewicht (inline gezählt,
--      SECURITY DEFINER) und verlässt keine Funktion — wie seit 0005.
--   🔒 Der Lesepfad gibt ausschließlich Anzeigedaten zurück, keine Zahlen.
--   ✦ Pro Nutzer steht immer nur EIN Moment im Corso. Ein weiterer Moment
--     desselben Autors verdrängt den laufenden Slot NICHT — er lebt daneben
--     (24 h) und ist über die Profil-Ansicht sichtbar.
--   ✦ Ein Moment kann höchstens EINMAL in den Corso — kein Wiedereintritt.
--   ✦ Kein hartes DELETE: eine Belegung wird geschlossen (left_at), nie
--     gelöscht. Die Historie bleibt für die Pilot-Auswertung vollständig.
--
-- WAS BEWUSST STEHEN BLEIBT (append-only, nichts wird gedroppt)
--   - `city_story_slots` samt der 52 Zeilen aus 25 echten Ziehungen: Historie.
--   - `draw_city_story()`, `run_city_story_draw()`, `city_story()`: ÜBERHOLT,
--     aber weiter vorhanden. Nur ihre Cron-Jobs werden abgestellt (Abschnitt 8).
--   - `corso_day()`: unverändert tragend für den verdeckten Circle-Zähler,
--     Nudge-Limits, reach_snapshots und alle Push-dedupe_keys. Der 21:00-Schnitt
--     verschwindet nur aus der ANZEIGE, nicht aus der Zeitrechnung.

-- ===========================================================================
-- 1. Konfiguration: wie viele Slots hat der Corso?
-- ===========================================================================
-- Liegt in app_config (seit 0024) — serverseitig, ohne Client-Lesepfad. Der
-- Client braucht die Zahl nicht: er rendert, was corso_now() liefert.
-- Größere Städte bekommen später schlicht einen höheren Wert.
insert into app_config (key, value)
values ('corso_slot_count', '10'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- 2. corso_slots — wer steht gerade auf der Bühne
-- ===========================================================================
-- Eine Zeile = eine Belegung eines Slots durch einen Moment. `left_at is null`
-- heißt „läuft gerade". Geschlossene Zeilen bleiben liegen: daraus lässt sich
-- später exakt rekonstruieren, wer wann wie lange im Corso stand.
create table if not exists corso_slots (
  id          uuid primary key default gen_random_uuid(),
  city        text        not null,
  slot        smallint    not null check (slot >= 0 and slot < 100),
  post_id     uuid        not null references posts (id) on delete cascade,
  -- denormalisiert, damit der „ein Moment pro Nutzer"-Guard ohne Join auskommt
  -- und die Historie auch nach dem Verfall des Posts lesbar bleibt.
  author_id   uuid        not null references profiles (id) on delete cascade,
  entered_at  timestamptz not null default now(),
  left_at     timestamptz
);

-- Ein Slot ist zu jedem Zeitpunkt höchstens einmal belegt. Partiell, damit
-- geschlossene Belegungen desselben Slots beliebig oft danebenliegen dürfen.
create unique index if not exists corso_slots_live_slot_idx
  on corso_slots (city, slot) where left_at is null;

-- „Belegt dieser Autor gerade einen Slot?" und „war dieser Post schon drin?"
create index if not exists corso_slots_live_author_idx
  on corso_slots (city, author_id) where left_at is null;
create unique index if not exists corso_slots_post_idx
  on corso_slots (post_id);

-- 🔒 RLS an, bewusst OHNE Policy + Grants entzogen: gelesen wird ausschließlich
-- über corso_now() / corso_latest_entry(). Sonst käme man an die Slot-Belegung
-- vorbei am Block-Filter (Muster wie app_config / follow_mutual_days).
alter table corso_slots enable row level security;
revoke all on corso_slots from public, anon, authenticated;

-- ===========================================================================
-- 3. Push-Anlass 5 — „dein Moment ist gerade in den Corso gerückt"
-- ===========================================================================
-- Ersetzt den weggefallenen Post-Anlass: da es keinen Prompt und kein 21:00-
-- Ritual mehr gibt, ist die Chance auf einen Slot der einzige Grund zu posten —
-- und der Einzug ist die Auszahlung. Bewusst NICHT der geparkte 21-Uhr-Event:
-- das hier ist persönlich und feuert, wann immer jemand nachrückt.
-- 🔒 Keine Zahl im Text (Sperrbildschirm-Regel aus 0018).
--
-- Liste vollständig wiederholen (Muster 0028): der Check ersetzt den alten.
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('city_story', 'city_story_soon', 'new_moment', 'audience_expiring',
                  'broadcast', 'circle_message', 'corso_entered'));

-- ===========================================================================
-- 4. refill_corso(city) — die laufende Nachbesetzung. Das Herz des Umbaus.
-- ===========================================================================
-- Ablauf pro Lauf:
--   1. Belegungen schließen, deren Moment seine 24 h erreicht hat.
--   2. Belegungen jenseits der (evtl. verkleinerten) Slot-Zahl schließen.
--   3. Freie Slot-Indizes bestimmen.
--   4. Kandidaten sammeln: lebend + einwilligend + richtige Stadt, Autor belegt
--      gerade keinen Slot, Post war noch nie im Corso. Pro Autor genau EIN
--      Kandidat — sein NEUESTER passender Moment (mehrere lebende Momente sind
--      seit 0032 erlaubt; der Corso zeigt das Aktuelle, und niemand bekommt
--      durch Vielposten mehr Lose).
--   5. Gewichtete Ziehung ohne Zurücklegen, unverändert aus 0005/0018:
--        w = 1 + ln(1 + aktive Follower),  Schlüssel = random()^(1/w)
--      Die größten Schlüssel füllen die freien Slots, aufsteigend nach Index.
--   6. Pro Einzug: ein `story_drawn`-Event und ein persönlicher Push.
--
-- Rückgabe: Anzahl der neu besetzten Slots.
create or replace function refill_corso(target_city text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_count int;
  entered    int := 0;
  -- now() ist innerhalb einer Transaktion konstant → taugt als exakte Marke,
  -- um direkt danach genau die Zeilen DIESES Laufs wiederzufinden.
  v_now      timestamptz := now();
begin
  select (value #>> '{}')::int into slot_count
  from app_config where key = 'corso_slot_count';
  slot_count := coalesce(slot_count, 10);

  -- (1) Abgelaufene Momente verlassen die Bühne. left_at = der Ablaufzeitpunkt
  --     selbst, nicht now() — dann stimmt die Standzeit in der Auswertung auch,
  --     wenn ein Cron-Lauf einmal ausfällt.
  update corso_slots cs
     set left_at = p.expires_at
    from posts p
   where p.id = cs.post_id
     and cs.city = target_city
     and cs.left_at is null
     and p.expires_at <= v_now;

  -- (2) Wurde die Slot-Zahl verkleinert, räumen die überzähligen Slots.
  update corso_slots
     set left_at = v_now
   where city = target_city
     and left_at is null
     and slot >= slot_count;

  -- (3)–(5) Freie Indizes gewichtet nachbesetzen.
  with occupied as (
    select slot, author_id
      from corso_slots
     where city = target_city and left_at is null
  ),
  free_ranked as (
    select g.i::smallint as slot, row_number() over (order by g.i) as rn
      from generate_series(0, slot_count - 1) g(i)
     where not exists (select 1 from occupied o where o.slot = g.i)
  ),
  cand as (
    -- Pro Autor sein neuester passender Moment (siehe Kopfkommentar Schritt 4).
    select distinct on (p.author_id)
           p.id as post_id,
           p.author_id,
           -- 🔒 Follower-Zahl nur intern fürs Gewicht, verlässt die Funktion nie:
           (select count(*) from follows f
             where f.followee_id = p.author_id and f.expires_at > v_now) as followers
      from posts p
      join profiles pr on pr.id = p.author_id
     where p.expires_at > v_now                 -- lebender Moment (rollende 24h)
       and p.city_story_consent = true          -- 🔒 nur Einwilligung
       and pr.city = target_city
       and not exists (select 1 from occupied o where o.author_id = p.author_id)
       and not exists (select 1 from corso_slots c where c.post_id = p.id)
     order by p.author_id, p.created_at desc
  ),
  ranked as (
    select post_id, author_id,
           row_number() over (
             order by power(random(), 1.0 / (1 + ln(1 + followers))) desc
           ) as rn
      from cand
  )
  insert into corso_slots (city, slot, post_id, author_id, entered_at)
  select target_city, f.slot, r.post_id, r.author_id, v_now
    from free_ranked f
    join ranked r on r.rn = f.rn;   -- der Join begrenzt auf min(frei, Kandidaten)

  get diagnostics entered = row_count;

  if entered > 0 then
    -- (6a) Metrik: ein story_drawn je Einzug. Enum existiert seit 0018;
    -- auth.uid() ist im Cron NULL, deshalb direkter Insert statt log_event().
    -- 🔒 metadata trägt nur Referenz-IDs/Enums, keine Zahlen.
    insert into events (user_id, event_type, metadata)
    select cs.author_id,
           'story_drawn',
           jsonb_build_object('post_id', cs.post_id, 'slot', cs.slot,
                              'city', target_city, 'via', 'corso_refill')
      from corso_slots cs
     where cs.city = target_city and cs.entered_at = v_now;

    -- (6b) Der persönliche Push. dedupe_key am Post → höchstens einmal je
    -- Moment, egal wie oft ein Lauf wiederholt wird.
    insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
    select cs.author_id,
           'corso_entered',
           'Du stehst im Corso',
           'Dein Moment ist gerade nachgerückt. Deine Stadt sieht ihn.',
           '/story',
           'corso-entered',
           'corso_entered:' || cs.post_id::text
      from corso_slots cs
      join profiles p on p.id = cs.author_id
     where cs.city = target_city
       and cs.entered_at = v_now
       and p.push_enabled
       and exists (select 1 from push_subscriptions s where s.user_id = cs.author_id)
    on conflict (dedupe_key) do nothing;
  end if;

  return entered;
end;
$$;

revoke all on function refill_corso(text) from public;
revoke execute on function refill_corso(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- run_corso_refill() — Cron-Einstieg über alle Städte.
-- Kein Stunden-Guard mehr: der laufende Corso hat keine Uhrzeit. Damit
-- entfällt auch das DST-Doppel-Cron-Muster aus 0005/0015/0018/0022.
-- ---------------------------------------------------------------------------
create or replace function run_corso_refill()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c text;
begin
  for c in select distinct city from profiles loop
    perform refill_corso(c);
  end loop;
end;
$$;

revoke all on function run_corso_refill() from public;
revoke execute on function run_corso_refill() from anon, authenticated;

-- ===========================================================================
-- 5. corso_now(city) — der Lesepfad für den Corso-Screen
-- ===========================================================================
-- Tritt an die Stelle von city_story(). Unterschiede zur alten Funktion:
--   - kein story_date-Filter (es gibt keine Tages-Ziehung mehr),
--   - zusätzlich `p.expires_at > now()`: schließt das Lag-Fenster von bis zu
--     60 s zwischen dem Ablauf eines Moments und dem nächsten Cron-Lauf. Ein
--     toter Moment ist damit sofort weg, auch wenn seine Belegung noch offen ist.
-- 🔒 Nur Anzeigedaten, keine Zahlen. Block-Filter beidseitig wie in 0023.
create or replace function corso_now(target_city text default null)
returns table (
  slot        smallint,
  handle      text,
  media_path  text,
  media_type  text,
  media_paths text[],
  post_id     uuid,
  author_id   uuid,
  entered_at  timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select cs.slot, pr.handle, p.media_path, p.media_type, p.media_paths,
         p.id, p.author_id, cs.entered_at
  from corso_slots cs
  join posts p     on p.id = cs.post_id
  join profiles pr on pr.id = p.author_id
  where auth.uid() is not null
    and cs.left_at is null
    and p.expires_at > now()
    and cs.city = coalesce(
      target_city,
      (select city from profiles where id = auth.uid()),
      'Düsseldorf'
    )
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid()  and b.blocked_id = p.author_id)
         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid())
    )
  order by cs.slot
$$;

revoke all on function corso_now(text) from public;
revoke all on function corso_now(text) from anon;
grant execute on function corso_now(text) to authenticated;

-- ---------------------------------------------------------------------------
-- corso_latest_entry(city) — jüngster Einzug, für den „Neu"-Punkt am Corso-Tab.
-- Baut auf corso_now() auf und erbt damit Block-Filter und Lebend-Prüfung.
-- 🔒 Ein Zeitstempel, keine Zahl, kein Handle.
-- ---------------------------------------------------------------------------
create or replace function corso_latest_entry(target_city text default null)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select max(entered_at) from corso_now(target_city)
$$;

revoke all on function corso_latest_entry(text) from public;
revoke all on function corso_latest_entry(text) from anon;
grant execute on function corso_latest_entry(text) to authenticated;

-- ===========================================================================
-- 6. Dev-Werkzeuge (admin-gegatet, Muster aus 0006)
-- ===========================================================================
create or replace function dev_menu_corso_refill()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare c text; n int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  select coalesce(city, 'Düsseldorf') into c from profiles where id = auth.uid();
  c := coalesce(c, 'Düsseldorf');
  n := refill_corso(c);
  return format('Corso für %s nachbesetzt: %s Slot(s) neu belegt.', c, n);
end $$;
revoke all on function dev_menu_corso_refill() from public;
grant execute on function dev_menu_corso_refill() to authenticated;

-- Räumt die Bühne für den nächsten Testlauf. Schließt die laufenden Belegungen
-- (kein DELETE) — der nächste Refill-Lauf besetzt sofort neu. Damit dieselben
-- Momente wieder Kandidaten sind, werden ihre geschlossenen Zeilen entfernt;
-- das ist bewusst NUR im Dev-Pfad erlaubt (die Wiedereintritts-Sperre hängt an
-- corso_slots.post_id) und betrifft nie produktive Historie anderer Städte.
create or replace function dev_menu_corso_clear()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare c text; n int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  select coalesce(city, 'Düsseldorf') into c from profiles where id = auth.uid();
  c := coalesce(c, 'Düsseldorf');
  delete from corso_slots where city = c;
  get diagnostics n = row_count;
  return format('Corso für %s geleert: %s Belegung(en) entfernt. Der nächste Lauf besetzt neu.', c, n);
end $$;
revoke all on function dev_menu_corso_clear() from public;
grant execute on function dev_menu_corso_clear() to authenticated;

-- ===========================================================================
-- 7. Reparatur am Rande: der new_moment-Push zeigte auf eine tote Route
-- ===========================================================================
-- `/connections` gibt es seit dem Zwei-Achsen-Umbau (2. Sep) nicht mehr —
-- „Ich folge" lebt im Stadt-Screen. Ein Tipp auf die Benachrichtigung landete
-- damit ins Leere.
--
-- ACHTUNG beim Nachbauen: Grundlage ist die Fassung aus 0030 (`@`-Fix), NICHT
-- die aus 0018 — sonst kommt der Titel wieder als „@@handle" heraus. Geändert
-- ist hier ausschließlich die URL.
create or replace function enqueue_new_moment_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_handle text;
begin
  select handle into author_handle from profiles where id = new.author_id;
  if author_handle is null then
    return new;
  end if;

  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select f.follower_id,
         'new_moment',
         '@' || ltrim(author_handle, '@'),       -- @-Fix aus 0030, nicht zurückdrehen
         'hat gerade einen Moment gezeigt.',
         '/',                                    -- war '/connections' (tote Route)
         'moment:' || new.author_id::text,
         'new_moment:' || f.follower_id::text || ':' || new.id::text
    from follows f
    join profiles p on p.id = f.follower_id
   where f.followee_id = new.author_id
     and f.expires_at > now()
     and p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = f.follower_id)
     and (
       select count(*)
         from push_outbox o
        where o.user_id = f.follower_id
          and o.kind = 'new_moment'
          and o.created_at >= corso_day_start()
     ) < 3
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

-- ===========================================================================
-- 8. Cron: die laufende Nachbesetzung an, das 21:00-Ritual aus
-- ===========================================================================
create extension if not exists pg_cron;

-- Jede Minute. Kostet einen Blick auf eine zehnzeilige Tabelle — dieselbe
-- Größenordnung wie der bestehende push-dispatch. Damit ist ein frei
-- gewordener Slot nach höchstens 60 s wieder besetzt; die Anzeige ist dank der
-- Lebend-Prüfung in corso_now() schon vorher korrekt.
select cron.schedule('corso-refill', '* * * * *', 'select public.run_corso_refill()');

-- Die sechs Jobs des alten Rituals abstellen. Die zugehörigen FUNKTIONEN
-- bleiben bestehen (append-only) — sie sind ab hier überholt und werden von
-- nichts mehr aufgerufen. Bewusst KEIN Ersatz-Event um 21:00: das Thema ist
-- geparkt (Auftrag Dominik, 9. Sep 2026).
do $$
declare j text;
begin
  foreach j in array array[
    'city-story-draw-summer',  'city-story-draw-winter',   -- die Ziehung
    'city-story-push-summer',  'city-story-push-winter',   -- Ritual-Push 21:01
    'city-story-soon-summer',  'city-story-soon-winter'    -- Vorab-Push 20:45
  ] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 9. Überholte Funktionen als überholt markieren (nicht entfernen)
-- ===========================================================================
comment on function draw_city_story(text, boolean) is
  'ÜBERHOLT seit 0031 (laufender Corso). Kein Cron ruft sie mehr auf. Nachfolger: refill_corso(text).';
comment on function run_city_story_draw() is
  'ÜBERHOLT seit 0031. Cron abgestellt. Nachfolger: run_corso_refill().';
comment on function city_story(text) is
  'ÜBERHOLT seit 0031. Liest die eingefrorene Tages-Ziehung, die es nicht mehr gibt. Nachfolger: corso_now(text).';
comment on function enqueue_city_story_push() is
  'ÜBERHOLT seit 0031 (21:00-Ritual entfällt, Ersatz-Event bewusst geparkt).';
comment on function enqueue_city_story_soon_push() is
  'ÜBERHOLT seit 0031 (Vorab-Push 20:45 entfällt).';
comment on function latest_visible_post(uuid) is
  'Der Zweig „abgelaufen, aber im Stadt Corso" ist seit 0031 tot: eine Corso-Belegung endet jetzt exakt mit den 24 h des Moments (PRD §4.6 „bis zu 48 h" gestrichen). Die Funktion bleibt korrekt, der Zusatz greift nur nie mehr.';
comment on table city_story_slots is
  'HISTORIE der 21:00-Ziehungen bis 8. Sep 2026. Seit 0031 schreibt nichts mehr hinein; der laufende Corso lebt in corso_slots.';
