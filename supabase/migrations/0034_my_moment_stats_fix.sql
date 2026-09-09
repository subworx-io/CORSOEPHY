-- Corso — 0034: Fix zu 0033 (my_moment_stats)
--
-- 0033 war bereits verbucht, als der Fehler auffiel — deshalb append-only
-- nachgezogen statt editiert (dasselbe Muster wie 0026 → 0027).
--
-- DER FEHLER
--   Die Ausgabespalten hießen `created_at` und `expires_at`. In einer plpgsql-
--   Funktion mit RETURNS TABLE sind Ausgabespalten zugleich Variablen — sie
--   verdecken damit gleichnamige TABELLENSPALTEN im Rumpf:
--     ERROR 42702: column reference "expires_at" is ambiguous
--   Aufgefallen im Negativtest gegen die Live-DB, nicht im Trockenlauf: die
--   Mehrdeutigkeit schlägt erst beim AUSFÜHREN zu, nicht beim Anlegen.
--
-- DER FIX (zwei Maßnahmen, bewusst beide)
--   1. Ausgabespalten heißen jetzt `moment_created_at` / `moment_expires_at` —
--      exakt wie in my_feedback(), also auch konsistenter als vorher.
--   2. Jede Tabellenspalte im Rumpf ist qualifiziert (f.expires_at, f.created_at,
--      pv.post_id …). Damit kann derselbe Fehler auch bei einer künftigen
--      Umbenennung nicht wiederkommen.
--
-- 🔒 Unverändert: der Guard `p.author_id = auth.uid()` ist der erste Filter,
--    eine fremde oder unbekannte Post-ID liefert NULL Zeilen.

drop function if exists my_moment_stats(uuid);

create function my_moment_stats(p_post_id uuid)
returns table (
  views              integer,
  stayed             integer,
  moment_live        boolean,
  in_city_story      boolean,
  is_record          boolean,
  consent            boolean,
  moment_created_at  timestamptz,
  moment_expires_at  timestamptz
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
  from post_views pv where pv.post_id = p_post_id;

  -- „Sind geblieben": Leute, die seit DIESEM Moment erstmals gefolgt sind und
  -- immer noch da sind. f.created_at ist der Erst-Follow (followed_at wird beim
  -- Erneuern hochgesetzt und taugt hier nicht) — identisch zu my_feedback().
  select count(*)::integer into n_stayed
  from follows f
  where f.followee_id = uid
    and f.expires_at > now()
    and f.created_at >= m_created;

  -- Rekord gegen alle FRÜHEREN eigenen Momente. Ohne einen früheren Moment gibt
  -- es keinen Rekord zu brechen (sonst wäre der allererste immer einer).
  select count(*)::integer into prior_posts
  from posts p where p.author_id = uid and p.id <> p_post_id;

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

comment on function my_moment_stats(uuid) is
  'Moment-bezogene Zahlen für einen EIGENEN Moment. 🔒 Guard: author_id = auth.uid() — fremde Post-IDs liefern keine Zeile. Personen-bezogene Zahlen (Follower, auf der Kippe, Serie) bleiben in my_feedback().';
