-- Corso — Phase 0.5: Täglicher Follow-Verfall (08:00 Europe/Berlin)
-- Bezug: docs/PRD.md §4.3 (verfallendes Publikum), docs/ROADMAP.md Phase 0.
--
-- Änderungen:
--   1. follows.expires_at    — Verfall-Zeitstempel (NULL = aktiv)
--   2. connections           — Schema für gegenseitige Verbindungen (Logik kommt Phase 1)
--   3. my_reach()            — zählt nur noch aktive Follows
--   4. expire_follows()      — Heartbeat-Funktion des Cron-Jobs
--   5. pg_cron               — täglich 07:00 UTC
--
-- Wichtig zur Zeitlogik (Zwei-Reset-Regel):
--   Client-Code (isExpired) lässt Follows erst am ZWEITEN 08:00-Reset ablaufen,
--   d.h. frühestens ~24h nach dem ersten Reset. Der Cron spiegelt das:
--   Bedingung ist corso_day(followed_at) < corso_day(now()) - 1
--   (≥ 2 Corso-Tage alt), nicht < 1 Tag.
--
-- pg_cron-Hinweis zur Zeitzone:
--   07:00 UTC = 08:00 CET (Winter, genau richtig)
--   07:00 UTC = 09:00 CEST (Sommer, 1h nach Reset — sicher, Funktion ist idempotent)
--   pg_cron kennt keine Zeitzonen; die Funktion selbst ist timezone-korrekt über
--   corso_day() (Europe/Berlin-aware). 1h Verzögerung im Sommer ist für den Pilot ok.
--
-- Voraussetzung: pg_cron muss im Supabase-Dashboard unter
--   Database → Extensions aktiviert sein, bevor diese Migration läuft.

-- ---------------------------------------------------------------------------
-- 1. follows: expires_at — Verfall markieren, nicht löschen
-- ---------------------------------------------------------------------------
alter table follows add column if not exists expires_at timestamptz null;

-- Partieller Index: my_reach() und expire_follows() lesen nur aktive Rows
create index if not exists follows_active_followee_idx
  on follows (followee_id)
  where expires_at is null;

-- ---------------------------------------------------------------------------
-- 2. connections — gegenseitige Verbindungen (verfallen NIEMALS durch den Reset)
--    Schema only — Befüllung kommt in Phase 1.
-- ---------------------------------------------------------------------------
create table if not exists connections (
  id            uuid primary key default gen_random_uuid(),
  user_a_id     uuid not null references profiles (id) on delete cascade,
  user_b_id     uuid not null references profiles (id) on delete cascade,
  connected_at  timestamptz not null default now(),
  -- Kanonische Reihenfolge: (A,B) und (B,A) werden zu einer einzigen Row
  check (user_a_id < user_b_id),
  unique (user_a_id, user_b_id)
);

alter table connections enable row level security;

-- Beide Seiten dürfen die gemeinsame Verbindung sehen
create policy connections_read_own
  on connections for select to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. my_reach() — nur aktive Follows zählen
-- ---------------------------------------------------------------------------
create or replace function my_reach()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int
  from follows
  where followee_id = auth.uid()
    and expires_at is null
$$;

-- Grants bleiben unverändert (gesetzt in 0001_init.sql)

-- ---------------------------------------------------------------------------
-- 4. expire_follows() — Heartbeat des täglichen Resets
--
--    Setzt expires_at auf Follows, die ≥ 2 Corso-Tage alt sind (= zweiter Reset
--    ist überschritten). Idempotent: Mehrfachaufruf am selben Tag ist sicher.
--    SECURITY DEFINER: kein auth.uid() im Cron-Kontext → RLS wird kontrolliert
--    umgangen; Funktion kann nur Follows ablaufen lassen, niemals erstellen.
-- ---------------------------------------------------------------------------
create or replace function expire_follows()
returns void
language sql
security definer
set search_path = public
as $$
  update follows
  set expires_at = now()
  where expires_at is null
    and corso_day(followed_at) < (corso_day(now()) - 1);
$$;

-- Kein public-Grant: nur der interne Cron-Aufruf (postgres-Rolle) nutzt sie.
revoke all on function expire_follows() from public;

-- ---------------------------------------------------------------------------
-- 5. pg_cron — täglich 07:00 UTC
--    cron.schedule() mit demselben Job-Namen = Upsert (idempotent bei Re-Run).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'expire-follows-daily',
  '0 7 * * *',
  'select public.expire_follows()'
);
