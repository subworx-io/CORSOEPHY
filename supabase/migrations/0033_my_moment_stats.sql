-- Corso — 0033: Zahlen pro EIGENEM Moment (my_moment_stats)
-- Auftrag Dominik, 9. Sep 2026, freigegeben.
--
-- WARUM
--   Seit 0032 kann eine Person mehrere lebende Momente haben, und seit dem
--   In-Place-Blättern (9. Sep) blättert man im Rücklauf durch sie hindurch.
--   `my_feedback()` liefert aber immer nur den JÜNGSTEN Moment samt seiner
--   Zahlen. Ohne diese Funktion zeigte der Rücklauf beim Blättern zu Moment 2
--   weiterhin die Zahlen von Moment 1 — eine stille Lüge auf genau dem Screen,
--   dessen einziger Zweck Zahlen sind.
--
-- 🔒 WARUM DAS DIE LEITPLANKE NICHT BRICHT
--   Die Regel lautet: „Kennzahl-Funktionen sind argumentlos — es gibt bewusst
--   keinen Weg, die Zahl eines ANDEREN Users abzufragen." Diese Funktion nimmt
--   ein Argument, aber es ist eine POST-ID, keine User-ID, und der erste Filter
--   im Body ist `p.author_id = auth.uid()`. Eine fremde Post-ID liefert damit
--   NULL Zeilen — nicht etwa fremde Zahlen. Der Aufrufer erfährt nicht einmal,
--   ob die ID existiert.
--   `my_feedback()` und `my_reach()` bleiben unverändert argumentlos.
--
-- ABGRENZUNG
--   Hier stehen ausschließlich MOMENT-bezogene Zahlen. Die PERSONEN-bezogenen
--   (Follower, „auf der Kippe", Serie) bleiben in my_feedback() — sie hängen
--   nicht am einzelnen Moment und würden beim Blättern nur flackern.

create or replace function my_moment_stats(p_post_id uuid)
returns table (
  views              integer,
  stayed             integer,
  moment_live        boolean,
  in_city_story      boolean,
  is_record          boolean,
  city_story_consent boolean,
  created_at         timestamptz,
  expires_at         timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid         uuid := auth.uid();
  m_created   timestamptz;
  m_expires   timestamptz;
  m_consent   boolean;
  n_views     integer := 0;
  n_stayed    integer := 0;
  in_corso    boolean := false;
  best_views  integer := 0;
  prior_posts integer := 0;
  record_hit  boolean := false;
begin
  if uid is null or p_post_id is null then
    return;  -- keine Zeile
  end if;

  -- 🔒 DER GUARD: nur eigene Momente. Fremde oder unbekannte IDs → keine Zeile.
  select p.created_at, p.expires_at, p.city_story_consent
    into m_created, m_expires, m_consent
  from posts p
  where p.id = p_post_id and p.author_id = uid;

  if m_created is null then
    return;  -- keine Zeile
  end if;

  -- Steht dieser Moment gerade im laufenden Corso? Seit 0031 liegt das in
  -- corso_slots (city_story_slots ist Historie). Eine Belegung endet exakt mit
  -- den 24h des Moments, deshalb reicht `left_at is null`.
  select exists (
    select 1 from corso_slots cs
    where cs.post_id = p_post_id and cs.left_at is null
  ) into in_corso;

  select count(*)::integer into n_views
  from post_views where post_id = p_post_id;

  -- „Sind geblieben": Leute, die seit DIESEM Moment erstmals gefolgt sind und
  -- immer noch da sind. created_at ist der Erst-Follow (followed_at wird beim
  -- Erneuern hochgesetzt und taugt hier nicht) — identisch zu my_feedback().
  select count(*)::integer into n_stayed
  from follows
  where followee_id = uid
    and expires_at > now()
    and created_at >= m_created;

  -- Rekord gegen alle FRÜHEREN eigenen Momente. Ohne einen früheren Moment gibt
  -- es keinen Rekord zu brechen (sonst wäre der allererste immer einer).
  select count(*)::integer into prior_posts
  from posts where author_id = uid and id <> p_post_id;

  if prior_posts > 0 then
    select coalesce(max(c), 0)::integer into best_views
    from (
      select count(*) as c
      from post_views pv
      join posts p on p.id = pv.post_id
      where p.author_id = uid and p.id <> p_post_id
      group by pv.post_id
    ) t;
    record_hit := n_views > 0 and n_views > best_views;
  end if;

  return query select
    n_views,
    n_stayed,
    (m_expires > now()) or in_corso,
    in_corso,
    record_hit,
    m_consent,
    m_created,
    m_expires;
end;
$$;

revoke all on function my_moment_stats(uuid) from public;
revoke all on function my_moment_stats(uuid) from anon;
grant execute on function my_moment_stats(uuid) to authenticated;
