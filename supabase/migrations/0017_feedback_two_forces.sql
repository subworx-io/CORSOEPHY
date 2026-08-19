-- ===========================================================================
-- 0017 — Rücklauf entlang der zwei Kräfte (PRD §1)
--
-- WARUM:
--   Der Rücklauf zeigte bisher zwei Bestandszahlen mit einem „seit gestern"-
--   Delta gegen reach_snapshots. Das war seit dem rollenden 24h-Verfall (0015)
--   sachlich falsch: „Zuschauer" zählt die Views EINES Moments, der Snapshot von
--   gestern zählte die Views eines ANDEREN Moments. Nach jedem neuen Moment
--   stürzte das Delta ab, obwohl nichts verloren ging.
--
--   Statt das Delta zu reparieren, fällt es weg. Der Rücklauf bezieht sich jetzt
--   auf DEINEN LAUFENDEN MOMENT und bildet die zwei Kräfte des Produkts ab:
--     - Aufstieg   → was dieser Moment eingebracht hat (views, stayed, city story)
--     - Schwerkraft→ was verfällt, wenn du nichts nachlieferst (at_risk)
--
--   reach_snapshots + der 21:05-Cron bleiben unangetastet — die Zeitreihe wird
--   für die Pilot-Auswertung gebraucht, nur der Screen liest sie nicht mehr.
--
-- LEITPLANKEN (unverändert):
--   - my_feedback() bleibt ARGUMENTLOS + SECURITY DEFINER. Es gibt bewusst keinen
--     Weg, die Zahlen eines anderen Users abzufragen. Kein Parameter „fürs
--     Debugging" — auch nicht für die neuen Felder.
--   - Alle Zahlen sind privat (🔒 PRD §4.3). anon/public bekommen kein execute.
--
-- BENENNUNG: neue Spalten englisch (Code-Konvention), die alten hießen deutsch.
--   followers/views heißen in der UI „Follower" / „Views"; die Mechanik heißt im
--   PRD weiterhin „verfallendes Publikum".
-- ===========================================================================

-- Rückgabetyp ändert sich → create or replace reicht nicht.
drop function if exists my_feedback();

create function my_feedback()
returns table (
  followers          integer,      -- aktive Follower (Bestand)
  views              integer,      -- eindeutige Betrachter DIESES Moments
  stayed             integer,      -- Erst-Follows seit dem Moment, die noch leben
  at_risk            integer,      -- Follower, die in den nächsten 12h neu entscheiden
  moment_id          uuid,
  moment_live        boolean,      -- lebt noch (24h) ODER steht im laufenden Stadt Corso
  moment_created_at  timestamptz,
  moment_expires_at  timestamptz,
  in_city_story      boolean,      -- dieser Moment ist im laufenden Stadt Corso
  is_record          boolean,      -- meistgesehener Moment, den du je hattest
  streak             integer       -- Corso-Tage in Folge mit Moment
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid         uuid := auth.uid();
  m_id        uuid;
  m_created   timestamptz;
  m_expires   timestamptz;
  m_live      boolean := false;
  in_story    boolean := false;
  n_followers integer := 0;
  n_views     integer := 0;
  n_stayed    integer := 0;
  n_at_risk   integer := 0;
  best_views  integer := 0;
  prior_posts integer := 0;
  record_hit  boolean := false;
  n_streak    integer := 0;
  d_cursor    date;
begin
  if uid is null then
    return query select 0, 0, 0, 0, null::uuid, false, null::timestamptz,
                        null::timestamptz, false, false, 0;
    return;
  end if;

  -- Follower: aktiver Bestand (identisch zu my_reach).
  select count(*)::integer into n_followers
  from follows
  where followee_id = uid and expires_at > now();

  -- Auf der Kippe: Follows, die in den nächsten 12h auslaufen. Das Fenster ist
  -- bewusst 12h — genau ab da ist Erneuern erlaubt (0015), die Leute sind also
  -- gerade wirklich in ihrer Entscheidungsphase.
  select count(*)::integer into n_at_risk
  from follows
  where followee_id = uid
    and expires_at > now()
    and expires_at < now() + interval '12 hours';

  -- Der Moment, auf den sich der Rücklauf bezieht: der jüngste — auch wenn er
  -- schon abgelaufen ist. Nach Ablauf friert der Screen seine Zahlen ein
  -- (Vergangenheitsform), statt eine irreführende 0 zu zeigen.
  select p.id, p.created_at, p.expires_at
    into m_id, m_created, m_expires
  from posts p
  where p.author_id = uid
  order by p.created_at desc
  limit 1;

  if m_id is not null then
    -- Im laufenden Stadt Corso? Dann bleibt der Moment sichtbar, auch wenn seine
    -- 24h währenddessen ablaufen (PRD §4.6 — das Rampenlicht verlängert ihn).
    select exists (
      select 1 from city_story_slots s
      where s.post_id = m_id and s.story_date = corso_day(now())
    ) into in_story;

    m_live := (m_expires > now()) or in_story;

    select count(*)::integer into n_views
    from post_views
    where post_id = m_id;

    -- Geblieben: Leute, die dir seit diesem Moment ERSTMALS gefolgt sind und
    -- immer noch da sind. created_at ist der Erst-Follow (followed_at wird beim
    -- Erneuern hochgesetzt und taugt hier nicht).
    select count(*)::integer into n_stayed
    from follows
    where followee_id = uid
      and expires_at > now()
      and created_at >= m_created;

    -- Bestwert über alle früheren eigenen Momente. Ohne einen früheren Moment
    -- gibt es keinen Rekord zu brechen (sonst wäre der allererste immer einer).
    select count(*)::integer into prior_posts
    from posts where author_id = uid and id <> m_id;

    if prior_posts > 0 then
      select coalesce(max(c), 0)::integer into best_views
      from (
        select count(*) as c
        from post_views pv
        join posts p on p.id = pv.post_id
        where p.author_id = uid and p.id <> m_id
        group by pv.post_id
      ) t;
      record_hit := n_views > 0 and n_views > best_views;
    end if;
  end if;

  -- Serie: Corso-Tage in Folge mit Moment. Kulanz — der laufende Zyklus bricht
  -- die Serie noch nicht, solange 21:00 nicht vorbei ist. Sonst stünde man
  -- morgens auf 0 für etwas, das man abends noch erledigen kann.
  d_cursor := corso_day(now());
  if not exists (select 1 from posts where author_id = uid and prompt_date = d_cursor) then
    d_cursor := d_cursor - 1;
  end if;
  loop
    exit when not exists (
      select 1 from posts where author_id = uid and prompt_date = d_cursor
    );
    n_streak := n_streak + 1;
    d_cursor := d_cursor - 1;
  end loop;

  return query select n_followers, n_views, n_stayed, n_at_risk, m_id, m_live,
                      m_created, m_expires, in_story, record_hit, n_streak;
end;
$$;

revoke all on function my_feedback() from public;
revoke all on function my_feedback() from anon;
grant execute on function my_feedback() to authenticated;

-- Index für den Serien-Rückwärtslauf und die „geblieben"-Zählung.
create index if not exists posts_author_prompt_date_idx on posts (author_id, prompt_date desc);
create index if not exists follows_followee_created_idx  on follows (followee_id, created_at);
