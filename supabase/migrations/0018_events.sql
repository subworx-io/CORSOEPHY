-- Corso — 0018: Metrik-Tracking / Event-Log ab Tag 1
-- Bezug: .claude/prds/metrik-tracking.prd.md, docs/PRD.md §5 (Kill-Metriken).
--
-- Ein leichtgewichtiges, SERVER-seitig geschriebenes Event-Log. Ziel ist NICHT
-- Analytics-Deluxe, sondern: die drei Kill-Metriken (Daily-Open-Rate, aktiver-
-- Post-Anteil, Chat-erreicht → Date) ab dem ersten User lückenlos rekonstruierbar
-- halten. Verpasste Roh-Events sind für immer weg.
--
-- Muster (write-only) 1:1 wie post_views (0010) und reports (0017):
--   - RLS an, KEINE Lese-Policy, KEINE direkte Insert-Policy.
--   - Schreiben ausschließlich über SECURITY-DEFINER-RPC log_event(), die
--     user_id serverseitig an auth.uid() pinnt (nicht fälschbar).
--   - Auswertung nur via service_role / SQL-Konsole (kein Client-Lesepfad).
--
-- 🔒 Leitplanken:
--   - Kein Nutzer liest events (auch nicht eigene) → kein Lesepfad auf fremde
--     private Daten. log_event() gibt nichts zurück.
--   - metadata speichert höchstens Referenz-IDs/Enums (post_id, followee_id,
--     kind, …) — nie Clip-Inhalte, Texte oder aggregierte Privatzahlen.
--
-- Tagesbegriff: gespeichert wird nur der rohe created_at. Tagesauswertungen
-- rechnen bewusst auf Kalendertag 00:00 Europe/Berlin (konsistent mit
-- city_moment_counts() in 0016), NICHT auf corso_day() (21:00). Die Zuordnung
-- passiert erst in der Auswertung.

-- ── events: kanonische Typen-Liste ──────────────────────────────────────────
-- app_open      — jede App-Öffnung/Rückkehr in den Vordergrund (Client)
-- moment_posted — Moment gepostet (Client, nach erfolgreichem Upload)
-- follow_set    — Follow gesetzt/erneuert (Client; kind in metadata)
-- follow_expired— Follow verfallen — RESERVIERT, wird derzeit NICHT gefeuert.
--                 Seit 0015 verfallen Follows implizit über expires_at > now();
--                 es gibt keinen Verfall-Cron mehr (0015 §9 hat ihn abgeschafft),
--                 also keinen Moment, an dem ein Event geschrieben werden könnte.
--                 Verfall ist bei der Auswertung aus follows.expires_at ableitbar.
--                 Der Enum-Wert bleibt reserviert (Produktentscheidung offen).
-- story_viewed  — Stadt Corso angesehen (Client, beim Öffnen des Story-Screens)
-- nudge_sent    — Anstupsen ausgelöst (Client)
-- chat_reached  — Verbindung erreicht Chat-Status — RESERVIERT (Phase 3, Chat
--                 existiert nicht). Wird jetzt nicht gefeuert.
-- story_drawn   — Stadt-Corso-Slot serverseitig gezogen (21:00-Job).
--                 BEWUSSTE Aufnahme (NICHT in der ursprünglichen kanonischen
--                 Liste der PRD): die PRD nennt „Story-Slot gezogen" als Server-
--                 Job-Event im Scope, ohne dafür einen Enum-Namen zu vergeben.
--                 story_drawn schließt diese Lücke sauber statt still. user_id =
--                 Autor des gezogenen Posts, geschrieben direkt in draw_city_story
--                 (dort ist auth.uid() NULL → kein log_event möglich).
create table events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  event_type  text not null check (event_type in (
    'app_open',
    'moment_posted',
    'follow_set',
    'follow_expired',
    'story_viewed',
    'nudge_sent',
    'chat_reached',
    'story_drawn'
  )),
  created_at  timestamptz not null default now(),
  metadata    jsonb
);

alter table events enable row level security;
-- KEINE Lese-Policy → kein Nutzer liest events (auch nicht eigene). Nur service_role/SQL.
-- KEINE direkte Insert-Policy → Schreiben ausschließlich über log_event() (DEFINER)
-- bzw. serverseitig in den Jobs, damit user_id nicht fälschbar ist.

-- Auswertungs-Indizes: „Events eines Users über die Zeit" (Daily-Open je User)
-- und „Events eines Typs über die Zeit" (stadtweite Aggregate je Event-Typ).
create index events_user_created_idx  on events (user_id, created_at);
create index events_type_created_idx  on events (event_type, created_at);

-- ── log_event(): user_id serverseitig gepinnt, Typ validiert ────────────────
-- Der EINZIGE Schreibweg für user-initiierte Events. Der Client übergibt nie
-- eine User-ID; user_id = auth.uid() ist damit nicht fälschbar. Gibt nichts
-- zurück (kein Lesepfad). p_event_type wird gegen dieselbe kanonische Liste
-- validiert wie der Table-Check.
create or replace function log_event(
  p_event_type text,
  p_metadata   jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_event_type not in (
    'app_open', 'moment_posted', 'follow_set', 'follow_expired',
    'story_viewed', 'nudge_sent', 'chat_reached', 'story_drawn'
  ) then
    raise exception 'invalid event_type: %', p_event_type;
  end if;

  insert into events (user_id, event_type, metadata)
  values (auth.uid(), p_event_type, p_metadata);
end;
$$;

revoke all on function log_event(text, jsonb) from public;
revoke all on function log_event(text, jsonb) from anon;
grant execute on function log_event(text, jsonb) to authenticated;

-- ── draw_city_story(): Ziehung + story_drawn-Event pro gezogenem Slot ────────
-- Body 1:1 aus 0015 übernommen (0015 darf nicht editiert werden → create or
-- replace hier). EINZIGE Ergänzung: nach dem Insert der Slots wird pro gezogenem
-- Post ein story_drawn-Event geschrieben. auth.uid() ist im Cron NULL, deshalb
-- direkter Insert in events (nicht über log_event). user_id = Autor des Posts.
-- 🔒 metadata trägt nur Referenz-IDs/Enums (post_id, slot, city), keine Zahlen.
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

  -- NEU ggü. 0015: pro gezogenem Slot ein story_drawn-Event für den Autor.
  -- Nur die Slots DIESER Ziehung (story_date = d, city = target_city).
  insert into events (user_id, event_type, metadata)
  select
    p.author_id,
    'story_drawn',
    jsonb_build_object('post_id', s.post_id, 'slot', s.slot, 'city', target_city)
  from city_story_slots s
  join posts p on p.id = s.post_id
  where s.story_date = d and s.city = target_city;

  return inserted;
end;
$$;

revoke all on function draw_city_story(text, boolean) from public;
revoke execute on function draw_city_story(text, boolean) from anon, authenticated;
