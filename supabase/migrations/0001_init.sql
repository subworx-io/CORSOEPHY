-- Corso — Phase 0: Datenmodell (Backend-Fundament)
-- Bezug: docs/PRD.md §4 (Kern-Mechaniken), docs/ROADMAP.md Phase 0.
--
-- Leitplanken, die hier strukturell durchgesetzt werden:
--   🔒 Follower-Zahlen sind für andere unsichtbar  -> RLS auf follows + my_reach()
--   🔒 Einwilligung pro Post, ob Stadt-Story-fähig -> posts.city_story_consent
--   🔒 Live-Kamera-Pflicht                          -> Client-seitig (use-camera.ts), kein Galerie-Pfad
--
-- Zeitlogik: Ein "Corso-Tag" läuft von 08:00 bis 08:00 (Europe/Berlin).
-- Alles Tagesseitige (Prompt, Posts, Discovery, Follow-Verfall) hängt an diesem Fenster.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helper: Corso-Tag zu einem Zeitpunkt (Datum des 08:00→08:00-Fensters)
-- ---------------------------------------------------------------------------
-- ts vor 08:00 Berlin gehört noch zum Vortag. Wir verschieben um 8h zurück und
-- nehmen das Datum in Berliner Zeit.
create or replace function corso_day(ts timestamptz default now())
returns date
language sql
immutable
as $$
  select ((ts at time zone 'Europe/Berlin') - interval '8 hours')::date
$$;

-- ---------------------------------------------------------------------------
-- profiles — 1 Gesicht = 1 Handle
-- ---------------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text unique not null check (handle ~ '^@[a-z0-9._]{2,30}$'),
  city        text not null default 'Düsseldorf',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- prompts — täglicher Prompt, einer pro Corso-Tag (erscheint 08:00)
-- ---------------------------------------------------------------------------
create table prompts (
  id           uuid primary key default gen_random_uuid(),
  prompt_date  date unique not null,
  text         text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- posts — der "Moment". Lebt bis zum nächsten 08:00-Reset (~24h).
-- ---------------------------------------------------------------------------
create table posts (
  id                  uuid primary key default gen_random_uuid(),
  author_id           uuid not null references profiles (id) on delete cascade,
  prompt_date         date not null default corso_day(),
  media_path          text not null,                       -- Pfad im Storage-Bucket 'moments'
  media_type          text not null check (media_type in ('photo', 'video')),
  city_story_consent  boolean not null default false,      -- 🔒 Einwilligung pro Post
  created_at          timestamptz not null default now(),
  -- Ein Moment pro Person pro Corso-Tag (Re-Post ersetzt via upsert).
  unique (author_id, prompt_date)
);

create index posts_prompt_date_idx on posts (prompt_date);
create index posts_author_idx on posts (author_id);

-- ---------------------------------------------------------------------------
-- follows — verfallendes Publikum (PRD §4.3)
-- followed_at = Zeitpunkt des letzten (Re-)Follows -> Basis fürs verfallende Herz.
-- Refolge erst ab nächstem 08:00-Reset (kein Doppel-Follow am selben Tag).
-- Der 08:00-Job entfernt Follows, die im letzten Zyklus NICHT erneuert wurden.
-- ---------------------------------------------------------------------------
create table follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references profiles (id) on delete cascade,
  followee_id  uuid not null references profiles (id) on delete cascade,
  followed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  check (follower_id <> followee_id),
  unique (follower_id, followee_id)
);

create index follows_follower_idx on follows (follower_id);
create index follows_followee_idx on follows (followee_id);

-- ---------------------------------------------------------------------------
-- nudges — Anstupsen (PRD §4.5): 1 pro Person pro Tag, Empfänger sieht Absender.
-- ---------------------------------------------------------------------------
create table nudges (
  id          uuid primary key default gen_random_uuid(),
  nudger_id   uuid not null references profiles (id) on delete cascade,
  nudged_id   uuid not null references profiles (id) on delete cascade,
  nudge_date  date not null default corso_day(),
  created_at  timestamptz not null default now(),
  check (nudger_id <> nudged_id),
  unique (nudger_id, nudged_id, nudge_date)
);

-- ---------------------------------------------------------------------------
-- city_story_slots — Stadt-Story 20:00, 8 Momente (Auswahl-Mechanismus: Phase 1)
-- Schema hier vorbereitet, Befüllung kommt mit dem 20:00-Job in Phase 1.
-- ---------------------------------------------------------------------------
create table city_story_slots (
  id          uuid primary key default gen_random_uuid(),
  story_date  date not null default corso_day(),
  post_id     uuid not null references posts (id) on delete cascade,
  slot        smallint not null check (slot between 0 and 7),
  created_at  timestamptz not null default now(),
  unique (story_date, slot),
  unique (story_date, post_id)
);

-- ---------------------------------------------------------------------------
-- reach_snapshots — Rücklauf (PRD §4 / Screen 7): private Zahl + Veränderung.
-- Pool-Zuschauer mitgezählt (PRD Entscheidung #3 = JA). Befüllung in Phase 1.
-- ---------------------------------------------------------------------------
create table reach_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  snapshot_date   date not null default corso_day(),
  follower_count  integer not null default 0,
  pool_viewers    integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table profiles          enable row level security;
alter table prompts           enable row level security;
alter table posts             enable row level security;
alter table follows           enable row level security;
alter table nudges            enable row level security;
alter table city_story_slots  enable row level security;
alter table reach_snapshots   enable row level security;

-- profiles: alle Eingeloggten sehen Handles/Bilder; jeder pflegt nur sich selbst.
create policy profiles_read_all   on profiles for select to authenticated using (true);
create policy profiles_insert_self on profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_self on profiles for update to authenticated using (id = auth.uid());

-- prompts: alle lesen; Schreiben nur serverseitig (service_role umgeht RLS).
create policy prompts_read_all on prompts for select to authenticated using (true);

-- posts: alle Eingeloggten sehen alle Posts (Discovery/Story); schreiben nur eigene.
create policy posts_read_all    on posts for select to authenticated using (true);
create policy posts_insert_self on posts for insert to authenticated with check (author_id = auth.uid());
create policy posts_update_self on posts for update to authenticated using (author_id = auth.uid());
create policy posts_delete_self on posts for delete to authenticated using (author_id = auth.uid());

-- follows: 🔒 Niemand darf sehen, wer IHM folgt oder wie viele -> nur eigene
-- (follower_id = ich) sind lesbar. Die eigene Publikumsgröße liefert my_reach().
create policy follows_read_own   on follows for select to authenticated using (follower_id = auth.uid());
create policy follows_insert_own on follows for insert to authenticated with check (follower_id = auth.uid());
create policy follows_update_own on follows for update to authenticated using (follower_id = auth.uid());
create policy follows_delete_own on follows for delete to authenticated using (follower_id = auth.uid());

-- nudges: Absender und Empfänger sehen den Anstupser (PRD §4.5).
create policy nudges_read_involved on nudges for select to authenticated
  using (nudger_id = auth.uid() or nudged_id = auth.uid());
create policy nudges_insert_own on nudges for insert to authenticated with check (nudger_id = auth.uid());

-- city_story_slots: alle sehen die Stadt-Story; Befüllung serverseitig.
create policy story_read_all on city_story_slots for select to authenticated using (true);

-- reach_snapshots: 🔒 streng privat — nur die eigenen Zahlen.
create policy reach_read_own on reach_snapshots for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- my_reach() — eigene Publikumsgröße OHNE die Identitäten preiszugeben.
-- SECURITY DEFINER umgeht RLS kontrolliert und gibt nur die nackte Zahl zurück.
-- ---------------------------------------------------------------------------
create or replace function my_reach()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int from follows where followee_id = auth.uid()
$$;

revoke all on function my_reach() from public;
grant execute on function my_reach() to authenticated;
