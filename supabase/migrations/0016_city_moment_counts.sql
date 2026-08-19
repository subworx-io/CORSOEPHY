-- Corso — 0016: Gemeinschafts-Zähler auf der Discovery ("X Momente heute in Düsseldorf")
-- Bezug: .claude/prds/gemeinschafts-zaehler.prd.md.
--
-- Ein dezentes Stimmungsbild der Stadt: wie viele Momente heute (und gestern)
-- gepostet wurden. Bewusst KEINE exakte Feed-Abbildung, sondern eine über den
-- Tag wachsende Zahl — ein Grund, mehrfach reinzuschauen.
--
-- Bewusste Entscheidungen (siehe PRD):
--   - Nur Stadt-Story-freigegebene Momente (city_story_consent = true) — konsistent
--     mit dem Consent-Filter. Die Zahl liegt damit unter der tatsächlichen Postmenge.
--   - Zeitfenster = Kalendertag in Europe/Berlin (00:00), NICHT der Corso-Tag
--     (corso_day() schneidet um 08:00). Beide Zeitbegriffe existieren parallel.
--   - Entkoppelt vom 24h-Verfall: gezählt wird nach created_at, nie über expires_at.
--     Posts werden nie gelöscht, daher trägt der Zähler die volle Tageshistorie.
--   - Düsseldorf ist der einzige Stadtraum im Pilot → kein Stadt-Filter/-Join nötig.
--
-- Muster analog zu my_reach() (0004) / my_feedback() (0010): argumentlos, gibt nur
-- nackte Zahlen zurück (keine Zeilen/IDs → kein Join-Leak), security definer für eine
-- RLS-unabhängige, stadtweit identische Zahl.

create or replace function city_moment_counts()
returns table (today integer, yesterday integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) filter (
      where (created_at at time zone 'Europe/Berlin')::date
            = (now() at time zone 'Europe/Berlin')::date
    )::integer as today,
    count(*) filter (
      where (created_at at time zone 'Europe/Berlin')::date
            = (now() at time zone 'Europe/Berlin')::date - 1
    )::integer as yesterday
  from posts
  where city_story_consent = true;
$$;

revoke all on function city_moment_counts() from public;
revoke all on function city_moment_counts() from anon;
grant execute on function city_moment_counts() to authenticated;
