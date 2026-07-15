-- Corso — Phase 1: Rücklauf-Screen (Datenquelle für die Kill-Metrik "aktiver-Post-Anteil")
-- Bezug: docs/PRD.md §4.3, §5 Screen 7, Entscheidung #3 (Pool-Zuschauer = JA); docs/STATUS.md.
--
-- Der Rücklauf zeigt ZWEI streng private Zahlen, jeweils mit "seit gestern"-Delta:
--   1. Publikum  = aktive Follower (= my_reach)              — dein stehendes Publikum
--   2. Zuschauer = eindeutige Betrachter deines letzten Moments (inkl. anonymer
--                  Pool-Zuschauer, die dir NICHT folgen)     — Reichweite deines Clips
--
--   Bewusst NUR zwei Zahlen: "Follower" und "Publikum" wären dieselbe Größe
--   (aktive Follows) → keine Redundanz anzeigen (Abstimmung Maxim/Dominik).
--
-- 🔒 Leitplanken, hier strukturell durchgesetzt:
--   - Alle Zahlen sind PRIVAT. Einzige Lese-Oberfläche ist my_feedback() —
--     SECURITY DEFINER, ARGUMENTLOS, an auth.uid() gepinnt, gibt nur Skalare
--     zurück. Kein Parameter → keine fremde user_id/post_id einschleusbar.
--   - post_views: NIEMAND darf sehen, WER gesehen hat. Keine Client-Policies →
--     RLS verweigert jeden Direktzugriff; nur die DEFINER-Funktionen zählen/schreiben.
--     Der Autor bekommt nie Betrachter-Identitäten, nur die nackte Zahl.
--   - Kein Ranking, kein Vergleich mit anderen.

-- ---------------------------------------------------------------------------
-- 1. post_views — anonyme Ansichten-Erfassung (nur Zählung, kein Name)
--    Eine Row je (Post, Betrachter): so zählt eine Person pro Moment genau einmal.
--    "Anonym" = anonym FÜR DEN AUTOR (kein Name), nicht unangemeldet: jeder
--    Betrachter ist eingeloggt und hat eine ID, wird aber nie namentlich gezeigt.
-- ---------------------------------------------------------------------------
create table if not exists post_views (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts (id) on delete cascade,
  viewer_id   uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (post_id, viewer_id)
);

create index if not exists post_views_post_idx on post_views (post_id);

-- RLS an, aber BEWUSST OHNE jede Policy: damit ist jeder direkte Client-Zugriff
-- (select/insert/update/delete) verboten. Geschrieben/gezählt wird ausschließlich
-- über die SECURITY-DEFINER-Funktionen unten (laufen als Tabellen-Owner, umgehen
-- RLS kontrolliert). So kann niemand die Betrachter eines fremden Posts auslesen.
alter table post_views enable row level security;

-- ---------------------------------------------------------------------------
-- 2. record_view(post) — eine Ansicht des Aufrufers verbuchen.
--    Der Client feuert das fire-and-forget, sobald ein Clip aktiv wird
--    (Discovery / Stadt-Story / Ich-folge). Idempotent, Self-Views zählen nicht.
--    Schreibt AUSSCHLIESSLICH viewer_id = auth.uid() → B kann keine fremde
--    Ansicht fälschen und keine Zahl auslesen.
-- ---------------------------------------------------------------------------
create or replace function record_view(target_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  -- Eigener Moment zählt nicht als Zuschauer.
  if exists (select 1 from posts where id = target_post and author_id = auth.uid()) then
    return;
  end if;
  insert into post_views (post_id, viewer_id)
  values (target_post, auth.uid())
  on conflict (post_id, viewer_id) do nothing;
end;
$$;

revoke all on function record_view(uuid) from public;
revoke all on function record_view(uuid) from anon;
grant execute on function record_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. my_feedback() — die EINZIGE Lese-Oberfläche des Rücklaufs.
--    Argumentlos, alles an auth.uid() gepinnt, gibt nur Zahlen zurück
--    (keine Zeilen/IDs/Namen → kein Join-Leak). Delta wird serverseitig gerechnet.
--
--    publikum        = aktive Follower jetzt (live, wie my_reach)
--    zuschauer       = eindeutige Betrachter des NEUESTEN eigenen Moments (live)
--    *_delta         = live − jüngster Snapshot vor dem heutigen Corso-Tag
--    has_yesterday   = false, solange es kein Gestern gibt (erster Rücklauf)
-- ---------------------------------------------------------------------------
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
  where followee_id = uid and expires_at is null;

  -- Zuschauer: eindeutige Betrachter des neuesten eigenen Moments.
  select id into latest_post
  from posts
  where author_id = uid
  order by created_at desc
  limit 1;

  if latest_post is null then
    zus := 0;
  else
    select count(*)::integer into zus
    from post_views
    where post_id = latest_post;
  end if;

  -- Gestern: jüngster Snapshot vor dem heutigen Corso-Tag.
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

-- ---------------------------------------------------------------------------
-- 4. snapshot_reach() — nächtlicher Snapshot als Basis für die "seit gestern"-Deltas.
--    Schreibt pro Profil den aktuellen Stand (aktive Follower + eindeutige
--    Zuschauer des jeweils neuesten Moments), getaggt mit dem heutigen Corso-Tag.
--    Läuft nach dem 08:00-Reset (siehe Cron unten) → corso_day ist bereits
--    umgesprungen, der Snapshot bildet die Morgen-Basislinie des neuen Tages.
--    Idempotent: Mehrfachlauf am selben Tag überschreibt (kein Duplikat).
-- ---------------------------------------------------------------------------
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
       where f.followee_id = pr.id and f.expires_at is null),
    coalesce((
      select count(*)::integer from post_views v
      where v.post_id = (
        select p.id from posts p
        where p.author_id = pr.id
        order by p.created_at desc
        limit 1
      )
    ), 0)
  from profiles pr
  on conflict (user_id, snapshot_date) do update
    set follower_count = excluded.follower_count,
        pool_viewers   = excluded.pool_viewers;
end;
$$;

revoke all on function snapshot_reach() from public;
revoke all on function snapshot_reach() from anon;

-- ---------------------------------------------------------------------------
-- 5. pg_cron — täglich 07:05 UTC, sicher NACH dem 08:00-Berlin-Reset:
--      07:05 UTC = 08:05 CET (Winter) / 09:05 CEST (Sommer) → corso_day umgesprungen,
--      und nach expire-follows-daily (07:00 UTC) → der Snapshot bildet den
--      Morgen-Stand des neuen Tages ab. cron.schedule() ist per Job-Name ein Upsert.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'reach-snapshot-daily',
  '5 7 * * *',
  'select public.snapshot_reach()'
);
