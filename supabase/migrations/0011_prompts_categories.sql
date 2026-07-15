-- Corso — Prompts: Kategorien (Hebel) + gewichtete Rotation + Historie.
-- Bezug: docs/PRD.md §4.2 (täglicher Prompt), CLAUDE.md (Kern-Mechaniken).
--
-- Warum: Die alten Prompts waren zu introspektiv/„heavy". Die neuen sind leicht &
-- filmbar und in drei Hebel eingeteilt: 'zeig' | 'augenzwinkern' | 'funken'.
-- Wir wollen (a) Prompts pflegbar in der DB steuern, (b) die Rotation nach
-- Kategorie gewichten (~40/40/20), (c) messen, welcher Prompt an welchem Tag lief
-- (Grundlage für Post-Raten pro Prompt im Pilot).
--
-- Diese Migration ist reine Struktur/Logik. Der Seed (alte deaktivieren, neue
-- einspielen) liegt in 0012_seed_prompts_v2.sql.

-- ---------------------------------------------------------------------------
-- 1. Kategorie-Enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prompt_category') then
    create type prompt_category as enum ('zeig', 'augenzwinkern', 'funken');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. prompts erweitern
--    - category : der Hebel (NULL = Alt-Prompt, wird nie gezogen)
--    - active   : Prompt aus der Rotation nehmen ohne Löschen (Audit bleibt heil)
--    active_date bleibt bestehen und dient weiter als billiger LRU-Marker
--    (zuletzt gelaufen), damit die Auswahl „am längsten her zuerst" sortieren kann.
-- ---------------------------------------------------------------------------
alter table prompts add column if not exists category prompt_category;
alter table prompts add column if not exists active   boolean not null default true;

-- ---------------------------------------------------------------------------
-- 3. daily_prompt — Historie: welcher Prompt lief an welchem Corso-Tag.
--    Kanonische Wahrheit für „was lief wann" (Messbarkeit + kein-Doppel-Check).
--    Genau eine Zeile pro Corso-Tag (PK), stadtweit identisch.
-- ---------------------------------------------------------------------------
create table if not exists daily_prompt (
  corso_day   date primary key,
  prompt_id   uuid not null references prompts (id) on delete restrict,
  category    prompt_category,
  created_at  timestamptz not null default now()
);

alter table daily_prompt enable row level security;

-- Lesen für alle Angemeldeten (der Tages-Prompt ist ohnehin öffentlich in der App).
-- Schreiben passiert ausschließlich über get_today_prompt() (SECURITY DEFINER,
-- umgeht RLS) — es gibt bewusst KEINE insert/update-Policy für Clients.
drop policy if exists daily_prompt_read_all on daily_prompt;
create policy daily_prompt_read_all on daily_prompt
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. get_today_prompt() — heutigen Prompt liefern oder erstmalig ziehen.
--
--    Ablauf (unter Advisory-Lock, damit die erste Zuweisung des Tages
--    serialisiert ist und nicht zwei Aufrufe zwei Prompts setzen):
--      1. Existiert für heute (corso_day) schon eine daily_prompt-Zeile?
--         → diesen Prompt zurück (eingefroren, stadtweit gleich).
--      2. Sonst: Kategorie GEWICHTET ziehen (~40% zeig / 40% augenzwinkern /
--         20% funken). Ist die gezogene Kategorie leer, in Gewichts-Reihenfolge
--         auf die nächste ausweichen.
--      3. In der Kategorie: nur active=true, GESTRIGEN Prompt ausschließen
--         (kein Doppel am Folgetag), sortiert „nie gelaufen zuerst, dann am
--         längsten her, dann Zufall".
--      4. daily_prompt-Zeile schreiben + active_date (LRU) aktualisieren.
--      5. Fallback: gibt es gar keinen kategorisierten aktiven Kandidaten
--         (z.B. Vorrat erschöpft), irgendeinen aktiven nehmen → nie NULL,
--         solange aktive Prompts existieren.
--
--    Rechte: parameterlos, kann nur aus aktiven/kategorisierten Prompts ziehen
--    und genau eine Historien-Zeile/Tag schreiben. Beliebige Prompt-INHALTE
--    schreiben bleibt Clients per RLS verwehrt → Leitplanke gewahrt. Daher darf
--    authenticated die Funktion aufrufen (der erste Nutzer des Tages löst die
--    Ziehung aus; alle weiteren lesen die bereits gesetzte Zeile).
-- ---------------------------------------------------------------------------
create or replace function get_today_prompt()
returns prompts
language plpgsql
security definer
set search_path = public
as $$
declare
  d        date := corso_day(now());
  yd       date := corso_day(now()) - 1;
  prev_id  uuid;
  r        double precision;
  ordered  prompt_category[];
  chosen   prompt_category;
  result   prompts;
begin
  perform pg_advisory_xact_lock(hashtext('corso_get_today_prompt')::bigint);

  -- (1) schon für heute gezogen?
  select p.* into result
  from daily_prompt dp
  join prompts p on p.id = dp.prompt_id
  where dp.corso_day = d;
  if found then
    return result;
  end if;

  -- gestrigen Prompt merken (kein Doppel am Folgetag)
  select prompt_id into prev_id from daily_prompt where corso_day = yd;

  -- (2) Kategorie gewichtet: primär nach Zufall, Fallbacks in Gewichts-Reihenfolge
  r := random();
  if r < 0.40 then
    ordered := array['zeig', 'augenzwinkern', 'funken']::prompt_category[];
  elsif r < 0.80 then
    ordered := array['augenzwinkern', 'zeig', 'funken']::prompt_category[];
  else
    ordered := array['funken', 'zeig', 'augenzwinkern']::prompt_category[];
  end if;

  -- (3) ersten Kategorie-Bucket mit einem gültigen Kandidaten nehmen
  foreach chosen in array ordered loop
    select p.* into result
    from prompts p
    where p.active = true
      and p.category = chosen
      and (prev_id is null or p.id <> prev_id)
    order by p.active_date asc nulls first, random()
    limit 1;
    if found then
      exit;
    end if;
  end loop;

  -- (5) globaler Fallback: irgendein aktiver Prompt (nie NULL zurückgeben)
  if not found then
    select p.* into result
    from prompts p
    where p.active = true
    order by p.active_date asc nulls first, random()
    limit 1;
    if not found then
      return null;  -- keine aktiven Prompts vorhanden
    end if;
  end if;

  -- (4) einfrieren: LRU-Marker + Historie
  update prompts set active_date = d where id = result.id returning * into result;
  insert into daily_prompt (corso_day, prompt_id, category)
  values (d, result.id, result.category)
  on conflict (corso_day) do nothing;

  return result;
end;
$$;

-- Aufruf: authenticated löst die Ziehung aus / liest den Tages-Prompt.
-- (service_role behält Zugriff für interne Tools; anon bleibt außen vor.)
revoke all on function get_today_prompt() from public;
revoke execute on function get_today_prompt() from anon;
grant  execute on function get_today_prompt() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. prompt_performance — Datengrundlage für „welcher Prompt treibt Posts?".
--    Kein Dashboard, nur eine View: pro Prompt, wie oft gelaufen und wie viele
--    Posts an den jeweiligen Lauf-Tagen entstanden sind (posts.prompt_date ist
--    der Corso-Tag = daily_prompt.corso_day).
--    Nur für den Pilot-Betreiber (service_role), nicht für Endnutzer.
-- ---------------------------------------------------------------------------
create or replace view prompt_performance as
select
  p.id,
  p.text,
  p.category,
  p.active,
  count(distinct dp.corso_day)                         as times_run,
  count(po.id)                                         as total_posts,
  round(count(po.id)::numeric
        / nullif(count(distinct dp.corso_day), 0), 2)  as posts_per_run
from prompts p
left join daily_prompt dp on dp.prompt_id = p.id
left join posts po        on po.prompt_date = dp.corso_day
group by p.id, p.text, p.category, p.active;

revoke all on prompt_performance from public, anon, authenticated;
grant select on prompt_performance to service_role;
