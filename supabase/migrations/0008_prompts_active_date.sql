-- Corso — Phase 1: Täglicher Prompt aus der DB (statt hartcodiert)
-- Bezug: docs/PRD.md §4.2 (täglicher Prompt), docs/ROADMAP.md Phase 1.
--
-- Die prompts-Tabelle existiert schon (0001_init.sql), war aber ungenutzt und
-- hatte ein anderes Schema (prompt_date NOT NULL). Wir bauen sie behutsam um
-- (ALTER, kein DROP, kein Row-DELETE → Leitplanke bleibt gewahrt):
--   - prompt_date  -> active_date  (der Tag, an dem der Prompt „dran" war)
--   - NOT NULL entfernt: Prompts ohne Datum sind die Ziehungs-Kandidaten.
-- Die bestehende RLS-Policy (prompts_read_all: read-only für authenticated,
-- Schreiben nur service_role) bleibt automatisch erhalten.

-- ---------------------------------------------------------------------------
-- 1. Umbau der Spalte
-- ---------------------------------------------------------------------------
alter table prompts rename column prompt_date to active_date;
alter table prompts alter column active_date drop not null;

-- Unique bleibt bestehen (mehrere NULLs sind erlaubt = viele undatierte Kandidaten);
-- nur der Constraint-Name wird kosmetisch mitgezogen.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'prompts_prompt_date_key') then
    alter table prompts rename constraint prompts_prompt_date_key to prompts_active_date_key;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. get_today_prompt() — heutigen Prompt liefern oder erstmalig zuweisen.
--
--    Ablauf:
--      - Ist für den heutigen Corso-Tag (corso_day) schon ein Prompt gesetzt?
--        → diesen zurückgeben (stadtweit identisch, eingefroren).
--      - Sonst: zufälligen Kandidaten ziehen (active_date IS NULL ODER älter als
--        90 Tage), dessen active_date auf heute setzen und zurückgeben.
--      - Fallback (alle vergeben): den am längsten zurückliegenden nehmen →
--        gibt NIE NULL zurück, solange überhaupt Prompts existieren.
--
--    Konsistenz zum 08:00-Rhythmus: Tag = corso_day() (08:00→08:00 Berlin),
--    nicht Kalendertag — damit der Prompt zeitgleich mit Discovery/Story/Follow
--    wechselt.
--
--    Nebenläufigkeit: pg_advisory_xact_lock serialisiert die erste Zuweisung des
--    Tages, sonst könnten zwei gleichzeitige Aufrufe zwei Prompts auf denselben
--    Tag setzen → Unique-Verletzung. Mit dem Lock gewinnt genau einer, der zweite
--    liest danach den bereits gesetzten.
--
--    SECURITY DEFINER: setzt active_date trotz „write nur service_role"-RLS.
--    Aufruf ist bewusst NICHT an authenticated/anon vergeben → nur die
--    Server-Action (service_role) darf die Zuweisung auslösen.
-- ---------------------------------------------------------------------------
create or replace function get_today_prompt()
returns prompts
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := corso_day(now());
  result prompts;
begin
  perform pg_advisory_xact_lock(hashtext('corso_get_today_prompt')::bigint);

  -- schon für heute zugewiesen?
  select * into result from prompts where active_date = d limit 1;
  if found then
    return result;
  end if;

  -- Kandidat: nie benutzt oder länger als 90 Tage her, zufällig
  select * into result
  from prompts
  where active_date is null or active_date < (d - 90)
  order by random()
  limit 1;

  -- Fallback: alle vergeben und jung → ältesten nehmen (nie NULL zurückgeben)
  if not found then
    select * into result from prompts order by active_date asc nulls first limit 1;
    if not found then
      return null;  -- Tabelle leer
    end if;
  end if;

  update prompts set active_date = d where id = result.id returning * into result;
  return result;
end;
$$;

-- Nur service_role (Server-Action) darf zuweisen — nicht der Client.
-- Supabase vergibt per Default-Privileges Execute an anon/authenticated → explizit
-- entziehen, sonst könnte ein Client die Zuweisung selbst auslösen (SECURITY DEFINER!).
revoke all on function get_today_prompt() from public;
revoke execute on function get_today_prompt() from anon, authenticated;
grant execute on function get_today_prompt() to service_role;
