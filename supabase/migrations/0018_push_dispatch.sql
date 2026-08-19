-- Corso — Push-Anlässe und Warteschlange.
--
-- Baut auf 0016 (Abos) auf. (Nummer 0017 ging an den Rücklauf-Umbau.) Hier entsteht, WANN Corso jemanden anspricht.
-- Der eigentliche Versand läuft in der Edge Function `send-push`, die diese
-- Warteschlange leert — die Datenbank hält keine Netzwerkverbindung.
--
-- Drei Anlässe, mehr nicht (Entscheidung 19. Aug 2026):
--   1. city_story        — 21:00, das Ritual. Neuer Prompt, Stadt Corso ist gezogen.
--   2. new_moment        — jemand, dem ich folge, hat etwas gezeigt.
--   3. audience_expiring — mein Publikum läuft aus, wenn ich nichts nachliefere.
--
-- 🔒 LEITPLANKE Follower-Privatsphäre: KEIN Push-Text enthält jemals eine Zahl
-- (Publikumsgröße, Zuschauer, Follower). Push-Texte erscheinen auf dem
-- Sperrbildschirm und sind damit potenziell für Umstehende lesbar — was im
-- Rücklauf privat ist, bleibt auch hier privat. Die Texte stehen deshalb
-- serverseitig hier und werden nicht vom Client mitgegeben.
--
-- 🔒 PRD-Entscheidung #7 (Privater Corso): der Ritual-Push feuert FIX um 21:00
-- für alle, nicht gestaffelt über ein Fenster 19–22 Uhr. Begründung: das
-- gemeinsame „zeitgleich" ist der Kern des Rituals; eine Staffelung löst genau
-- das auf. Damit ist #7 entschieden, nicht mehr offen.

-- ===========================================================================
-- 1. Warteschlange
-- ===========================================================================
create table if not exists push_outbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  kind        text not null check (kind in ('city_story', 'new_moment', 'audience_expiring')),
  title       text not null,
  body        text not null,
  url         text not null default '/',
  -- Der Benachrichtigungs-„tag": gleiche tags ersetzen einander auf dem Gerät,
  -- statt sich zu stapeln. Niemand soll morgens acht Corso-Zeilen vorfinden.
  tag         text not null,
  -- Verhindert Doppelungen an der Quelle: derselbe Anlass für dieselbe Person
  -- am selben Zyklus kann nur einmal in die Schlange. Der Einfüge-Pfad nutzt
  -- durchgehend `on conflict do nothing`.
  dedupe_key  text not null unique,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text
);

create index if not exists push_outbox_pending_idx
  on push_outbox (created_at)
  where sent_at is null;

-- 🔒 RLS an, aber bewusst OHNE jede Policy: kein Client hat hier etwas zu
-- suchen — weder lesend noch schreibend. Die Zeilen verraten sonst, wer wem
-- folgt. Nur die Edge Function (service_role) kommt heran, und die umgeht RLS.
alter table push_outbox enable row level security;

-- ===========================================================================
-- 2. Anlass 1 — das 21:00-Ritual
--
-- Adressat: jeder, der Push will und ein Gerät angemeldet hat. Kein Filter auf
-- „hat heute gepostet" — das Ritual gilt der ganzen Stadt, das ist der Punkt.
-- ===========================================================================
create or replace function enqueue_city_story_push()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
  day text := corso_day()::text;
begin
  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select distinct
         p.id,
         'city_story',
         'Deine Stadt geht spazieren',
         'Der Stadt Corso läuft. Und der neue Prompt steht.',
         '/story',
         'city-story',
         'city_story:' || p.id::text || ':' || day
    from profiles p
   where p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = p.id)
  on conflict (dedupe_key) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function enqueue_city_story_push() from public;
revoke execute on function enqueue_city_story_push() from anon, authenticated;

-- Cron-Wrapper nach dem Muster aus 0015: zwei Slots, die Funktion prüft selbst
-- die Berliner Stunde → DST-sicher, der „falsche" Slot läuft leer durch.
-- 21:01, eine Minute nach der Ziehung: der Stadt Corso soll stehen, wenn der
-- Push ankommt, sonst tippt jemand auf eine leere Bühne.
create or replace function run_city_story_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 21 then
    return;
  end if;
  perform enqueue_city_story_push();
end;
$$;

revoke all on function run_city_story_push() from public;
revoke execute on function run_city_story_push() from anon, authenticated;

-- ===========================================================================
-- 3. Anlass 2 — jemand, dem ich folge, hat etwas gezeigt
--
-- Trigger auf posts. Adressaten sind die AKTIVEN Follower des Autors
-- (expires_at > now()) — wessen Herz abgelaufen ist, bekommt nichts mehr.
--
-- Drosselung: höchstens 3 solcher Pushes pro Empfänger und Corso-Zyklus. Wer
-- zwanzig Leuten folgt, soll nicht zwanzig Mal aufblinken; ab dem vierten
-- Moment schweigt die App und der Rest wartet auf 21:00. Bewusst der frühen
-- Momente statt der letzten: der erste Anstoß am Abend zieht, der zehnte nervt.
-- ===========================================================================
create or replace function enqueue_new_moment_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_handle text;
  day text := corso_day()::text;
begin
  select handle into author_handle from profiles where id = new.author_id;
  if author_handle is null then
    return new;
  end if;

  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select f.follower_id,
         'new_moment',
         '@' || author_handle,
         'hat gerade einen Moment gezeigt.',
         '/connections',
         'moment:' || new.author_id::text,
         'new_moment:' || f.follower_id::text || ':' || new.id::text
    from follows f
    join profiles p on p.id = f.follower_id
   where f.followee_id = new.author_id
     and f.expires_at > now()
     and p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = f.follower_id)
     -- Drosselung, pro Empfänger und Zyklus
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

-- Hilfsfunktion: Beginn des laufenden Zyklus (letzte 21:00 Berlin) als
-- timestamptz. Gegenstück zu cycleStart() in src/lib/corso-day.ts. Bewusst
-- hier und nirgends sonst gerechnet — Datums-Arithmetik daneben zu bauen ist
-- laut CLAUDE.md genau das, was nicht passieren soll.
create or replace function corso_day_start()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((corso_day()::timestamp + interval '21 hours') at time zone 'Europe/Berlin');
$$;

drop trigger if exists posts_push_followers on posts;
create trigger posts_push_followers
  after insert on posts
  for each row
  execute function enqueue_new_moment_push();

-- ===========================================================================
-- 4. Anlass 3 — mein Publikum läuft aus
--
-- Adressat ist die Person, DEREN Publikum schrumpft — nicht der Folgende.
-- Grund: der Verfall ist die Aufforderung nachzuliefern („Publikum verfällt
-- 24 h nach dem Follow, wenn man nicht nachliefert", PRD). Wer bereits einen
-- lebenden Moment hat, hat nachgeliefert und wird nicht behelligt.
--
-- Ton: keine Zahl, kein Countdown, keine Drohung. Eine Feststellung.
-- ===========================================================================
create or replace function enqueue_audience_expiring_push()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
  day text := corso_day()::text;
begin
  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select distinct
         f.followee_id,
         'audience_expiring',
         'Dein Publikum wird still',
         'Heute Abend läuft es aus. Ein Moment hält es da.',
         '/record',
         'audience',
         'audience_expiring:' || f.followee_id::text || ':' || day
    from follows f
    join profiles p on p.id = f.followee_id
   where p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = f.followee_id)
     -- Publikum, das in den nächsten 6 Stunden verfällt
     and f.expires_at > now()
     and f.expires_at <= now() + interval '6 hours'
     -- ... aber nur, wenn nichts Lebendes da ist. Wer gepostet hat, ist fein raus.
     and not exists (
       select 1 from posts po
        where po.author_id = f.followee_id
          and po.expires_at > now()
     )
  on conflict (dedupe_key) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function enqueue_audience_expiring_push() from public;
revoke execute on function enqueue_audience_expiring_push() from anon, authenticated;

-- 18:00 Berlin — drei Stunden vor dem Ritual. Früh genug, um noch etwas
-- aufzunehmen; spät genug, dass der Tag schon gezeigt hat, ob jemand postet.
create or replace function run_audience_expiring_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 18 then
    return;
  end if;
  perform enqueue_audience_expiring_push();
end;
$$;

revoke all on function run_audience_expiring_push() from public;
revoke execute on function run_audience_expiring_push() from anon, authenticated;

-- ===========================================================================
-- 5. Versand-Schnittstelle für die Edge Function
--
-- claim_push_batch() nimmt Zeilen aus der Schlange und gibt sie zusammen mit
-- den Geräte-Abos zurück. `for update skip locked` macht parallele Läufe
-- ungefährlich; claimed_at verhindert, dass ein zweiter Aufruf dieselbe Zeile
-- noch einmal greift.
--
-- Nur für service_role. Kein Grant an authenticated — die Rückgabe enthält
-- fremde Push-Endpunkte.
-- ===========================================================================
create or replace function claim_push_batch(p_limit int default 200)
returns table (
  outbox_id uuid,
  endpoint  text,
  p256dh    text,
  auth      text,
  title     text,
  body      text,
  url       text,
  tag       text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    update push_outbox o
       set claimed_at = now(),
           attempts   = o.attempts + 1
     where o.id in (
       select id from push_outbox
        where sent_at is null
          -- Nicht sofort erneut greifen: ein hängender Lauf bekommt 5 Minuten.
          and (claimed_at is null or claimed_at < now() - interval '5 minutes')
          and attempts < 3
          -- Abgelaufene Anlässe nicht nachträglich zustellen: ein Ritual-Push
          -- am nächsten Morgen ist Müll, kein Nachtrag.
          and created_at > now() - interval '3 hours'
        order by created_at
        limit p_limit
        for update skip locked
     )
    returning o.id, o.user_id, o.title, o.body, o.url, o.tag
  )
  select c.id, s.endpoint, s.p256dh, s.auth, c.title, c.body, c.url, c.tag
    from claimed c
    join push_subscriptions s on s.user_id = c.user_id;
end;
$$;

revoke all on function claim_push_batch(int) from public;
revoke execute on function claim_push_batch(int) from anon, authenticated;

-- Rückmeldung des Versenders. Tote Abos (404/410) fliegen sofort raus — sie
-- kommen nie wieder, und ein Endpunkt, den wir nicht mehr brauchen, ist einer,
-- den wir nicht mehr speichern.
create or replace function report_push_result(
  p_outbox_id uuid,
  p_endpoint  text,
  p_ok        boolean,
  p_gone      boolean,
  p_error     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_gone then
    delete from push_subscriptions where endpoint = p_endpoint;
  elsif not p_ok then
    update push_subscriptions
       set failure_count = failure_count + 1
     where endpoint = p_endpoint;
  else
    update push_subscriptions
       set failure_count = 0,
           last_seen_at  = now()
     where endpoint = p_endpoint;
  end if;

  update push_outbox
     set sent_at    = case when p_ok then now() else sent_at end,
         last_error = left(p_error, 300)
   where id = p_outbox_id;
end;
$$;

revoke all on function report_push_result(uuid, text, boolean, boolean, text) from public;
revoke execute on function report_push_result(uuid, text, boolean, boolean, text) from anon, authenticated;

-- Aufräumen: zugestellte und endgültig gescheiterte Zeilen nach 7 Tagen weg.
create or replace function prune_push_outbox()
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_outbox
   where created_at < now() - interval '7 days';
$$;

revoke all on function prune_push_outbox() from public;
revoke execute on function prune_push_outbox() from anon, authenticated;

-- ===========================================================================
-- 6. Zeitplan
--   Zwei Slots je Ritual (Sommer-/Winterzeit), die Funktion prüft die Stunde.
--   cron.schedule() ist per Job-Name ein Upsert — Re-Run ist ungefährlich.
-- ===========================================================================
create extension if not exists pg_cron;

select cron.schedule('city-story-push-summer',    '1 19 * * *', 'select public.run_city_story_push()');
select cron.schedule('city-story-push-winter',    '1 20 * * *', 'select public.run_city_story_push()');
select cron.schedule('audience-expiring-summer',  '0 16 * * *', 'select public.run_audience_expiring_push()');
select cron.schedule('audience-expiring-winter',  '0 17 * * *', 'select public.run_audience_expiring_push()');
select cron.schedule('push-outbox-prune',         '30 3 * * *', 'select public.prune_push_outbox()');

-- ===========================================================================
-- 7. Auslöser: die Datenbank stupst die Edge Function an
--
-- Die Datenbank verschickt nichts selbst — sie ruft `send-push`, sobald etwas
-- in der Schlange liegt. Der Tick läuft minütlich, macht aber nur dann einen
-- HTTP-Aufruf, wenn es wirklich Arbeit gibt: an einem stillen Tag kostet das
-- 1440 billige Selects und null Function-Aufrufe.
--
-- URL und Secret kommen aus dem Supabase-Vault, nicht aus dieser Datei —
-- Migrationen liegen im Repo, Zugangsdaten haben darin nichts verloren.
-- Einmalig zu setzen (Dashboard → Integrations → Vault, oder per SQL):
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push',
--                              'push_dispatch_url');
--   select vault.create_secret('<langes zufälliges Geheimnis>',
--                              'push_dispatch_secret');
--
-- Dasselbe Geheimnis muss als Secret PUSH_DISPATCH_SECRET an der Edge Function
-- hinterlegt sein. Fehlt eines von beidem, läuft der Tick still ins Leere —
-- absichtlich: ein halb konfigurierter Push soll nichts kaputt machen.
-- ===========================================================================
create extension if not exists pg_net with schema extensions;

create or replace function dispatch_push()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target text;
  secret text;
begin
  -- Nichts zu tun? Dann auch keinen Function-Aufruf verbrennen.
  if not exists (
    select 1 from push_outbox
     where sent_at is null
       and attempts < 3
       and created_at > now() - interval '3 hours'
  ) then
    return;
  end if;

  select decrypted_secret into target from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if target is null or secret is null then
    return;
  end if;

  perform net.http_post(
    url     := target,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-corso-push-secret', secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function dispatch_push() from public;
revoke execute on function dispatch_push() from anon, authenticated;

select cron.schedule('push-dispatch', '* * * * *', 'select public.dispatch_push()');
