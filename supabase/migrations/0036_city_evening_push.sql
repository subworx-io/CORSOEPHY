-- Corso — 0036: Der Abend-Push. Die Stadt sagt leise Hallo.
--
-- Entscheidung 16. Sep 2026 (Dominik): EIN täglicher Push um 19:00 Berlin an
-- alle mit Push. Damit ist PRD-Entscheidung #7 („Privater Corso", Push-Fenster
-- 19–22 Uhr) beantwortet. Das geparkte 21-Uhr-Event bleibt geparkt — dieser
-- Push ist kein Ritual mit Ziehung, er ist eine Erinnerung mit Charakter.
--
-- Ton: als spräche die Stadt selbst — verspielt, leise, neugierig.
-- Nie ein Befehl, nie eine Zahl, nie falsche Dringlichkeit.
--
-- Baut ausschließlich auf der bestehenden Kette auf (0018): Einreihen in
-- push_outbox, Versand über den minütlichen dispatch_push()-Tick und die Edge
-- Function send-push. Keine zweite Push-Kette, kein Eingriff in
-- claim_push_batch() — dessen 3-Stunden-Verwerfen gilt damit auch hier: ein
-- verspäteter Abend-Push kommt spätestens um 22:00 noch an, danach gar nicht.
--
-- Inhalt:
--   1. Neue Sorte `city_evening`.
--   2. Textbank `city_evening_lines` (+ 25 Texte) — 🔒 keine Ziffer, per Check.
--   3. Ziehungs-Protokoll `city_evening_draws` — ein Text je Stadt und Corso-Tag.
--   4. draw_city_evening_line(city) — Zufall ohne Wiederholung in 20 Tagen.
--   5. enqueue_city_evening_push() + run_city_evening_push() — 19:00 Berlin.
--   6. dev_menu_test_evening_push() — der echte Abend-Push, nur an mich.
--   7. Cron (Sommer-/Winter-Slot).
--
-- Append-only: nichts wird gedroppt, nichts Bestehendes umgebaut.

-- ===========================================================================
-- 1. Sorte zulassen — Liste vollständig wiederholen (Muster 0028/0031)
-- ===========================================================================
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('city_story', 'city_story_soon', 'new_moment', 'audience_expiring',
                  'broadcast', 'circle_message', 'corso_entered', 'city_evening'));

-- ===========================================================================
-- 2. Textbank
-- ===========================================================================
-- Liegt in der DB statt im Code: Texte lassen sich per SQL pflegen, ohne
-- Deploy und ohne die Edge Function anzufassen. Aus der Rotation nimmt man
-- einen Text mit `active = false`, nicht mit DELETE (die Ziehungs-Historie
-- verweist darauf).
--
-- 🔒 LEITPLANKE „kein Push-Text enthält eine Zahl" (0018): Ziffern verbietet
-- der Check hart. Zahlwörter („zwei", „einmal") kann keine Prüfung sicher
-- erkennen — beim Ergänzen von Hand darauf achten.
create table if not exists city_evening_lines (
  id          uuid primary key default gen_random_uuid(),
  body        text not null
                check (char_length(btrim(body)) between 1 and 120)
                check (body !~ '[0-9]'),
  -- NULL = passt in jede Stadt. Sonst nur für diese Stadt (Rhein, Altstadt …).
  city        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (body)
);

-- 🔒 RLS an, bewusst OHNE Policy: kein Client liest die Bank. Der Text kommt
-- ausschließlich als Push aufs Gerät — wie bei push_outbox.
alter table city_evening_lines enable row level security;

insert into city_evening_lines (body, city) values
  ('Die Stadt zieht sich gerade die Schuhe an.',                              null),
  ('Draußen wird''s langsam interessant.',                                    null),
  ('Der Abend hat angefangen, ohne dich zu fragen.',                          null),
  ('Deine Stadt macht gleich die Augen auf.',                                 null),
  ('Die Straßen werden wieder gesprächig.',                                   null),
  ('Das Licht wird weich. Die Stadt auch.',                                   null),
  ('Die Laternen überlegen schon, ob sie angehen.',                           null),
  ('Die Stadt schlendert los. Ganz ohne Eile.',                               null),
  ('Der Feierabend hat die Straßen übernommen.',                              null),
  ('Die Stadt summt leise vor sich hin.',                                     null),
  ('Irgendwo wird gerade ein Fenster aufgemacht.',                            null),
  ('Die Stadt ist heute in Plauderlaune.',                                    null),
  ('Der Abend riecht nach Neuigkeiten.',                                      null),
  ('Es wird Abend. Die Stadt wird neugierig.',                                null),
  ('Heute Abend ist die Stadt ein bisschen verspielt.',                       null),
  ('Die Stadt zwinkert dir zu.',                                              null),
  ('Gerade beginnt der schönste Teil des Tages. Findet zumindest die Stadt.', null),
  ('Die Stadt reckt sich und schaut, wer noch unterwegs ist.',                null),
  ('Die Tauben machen Feierabend. Die Stadt noch lange nicht.',               null),
  ('Irgendwo am Rhein hat gerade jemand gelacht.',                            'Düsseldorf'),
  ('Die Altstadt räuspert sich.',                                             'Düsseldorf'),
  ('Die Rheinwiesen werden voller. Die Geschichten auch.',                    'Düsseldorf'),
  ('Zwischen den Straßenbahnen passiert gerade etwas Schönes.',               null),
  ('Die Stadt hat heute was gesehen. Sie erzählt es gern.',                   null),
  ('Der Abend streift durch die Straßen und pfeift.',                         null)
on conflict (body) do nothing;

-- ===========================================================================
-- 3. Ziehungs-Protokoll — welcher Text lief an welchem Corso-Tag
-- ===========================================================================
-- Ein Text je Stadt und Corso-Tag: die ganze Stadt bekommt denselben Satz
-- („die ganze Stadt sieht dasselbe"). Zugleich die Grundlage für die
-- Wiederholungssperre. Muster wie daily_prompt (0011), eigene Tabelle.
create table if not exists city_evening_draws (
  corso_day  date        not null,
  city       text        not null,
  line_id    uuid        not null references city_evening_lines (id),
  drawn_at   timestamptz not null default now(),
  primary key (corso_day, city)
);

alter table city_evening_draws enable row level security;

-- ===========================================================================
-- 4. Die Ziehung
-- ===========================================================================
-- Stabil: gibt es für (heute, Stadt) schon einen Text, kommt genau der zurück —
-- Cron, Wiederholungslauf und Dev-Test sehen denselben Satz.
-- Sonst: Zufall unter den aktiven Texten dieser Stadt, die in den letzten 20
-- Corso-Tagen nicht dran waren. Ist dieser Pool leer (Bank auf 20 oder weniger
-- geschrumpft), nimmt die Funktion den am längsten nicht gelaufenen Text,
-- statt ohne Push abzubrechen.
create or replace function draw_city_evening_line(p_city text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d       date := corso_day();
  line_id uuid;
  result  text;
begin
  select l.body into result
    from city_evening_draws dr
    join city_evening_lines l on l.id = dr.line_id
   where dr.corso_day = d and dr.city = p_city;
  if result is not null then
    return result;
  end if;

  select l.id into line_id
    from city_evening_lines l
   where l.active
     and (l.city is null or l.city = p_city)
     and not exists (
       select 1 from city_evening_draws dr
        where dr.line_id = l.id
          and dr.city = p_city
          and dr.corso_day > d - 20
     )
   order by random()
   limit 1;

  if line_id is null then
    select l.id into line_id
      from city_evening_lines l
      left join city_evening_draws dr on dr.line_id = l.id and dr.city = p_city
     where l.active
       and (l.city is null or l.city = p_city)
     group by l.id
     order by max(dr.corso_day) asc nulls first, random()
     limit 1;
  end if;

  if line_id is null then
    return null;  -- Bank leer: dann eben kein Abend-Push.
  end if;

  -- Parallel-Lauf: wer zuerst schreibt, gewinnt; der andere liest dessen Text.
  insert into city_evening_draws (corso_day, city, line_id)
  values (d, p_city, line_id)
  on conflict (corso_day, city) do nothing;

  select l.body into result
    from city_evening_draws dr
    join city_evening_lines l on l.id = dr.line_id
   where dr.corso_day = d and dr.city = p_city;
  return result;
end;
$$;

revoke all on function draw_city_evening_line(text) from public;
revoke execute on function draw_city_evening_line(text) from anon, authenticated;

-- ===========================================================================
-- 5. Einreihen — 19:00 Berlin
-- ===========================================================================
-- Adressat: jeder mit Push-Absicht und angemeldetem Gerät.
-- Ausnahme (Entscheidung 16. Sep, „nicht zu viele Pushes"): wer an diesem
-- Corso-Tag schon „Dein Publikum wird still" (18:00) bekommen hat, bekommt
-- keinen Abend-Push obendrauf. Höchstens ein geplanter Push pro Abend.
--
-- Titel = Stadtname: die Stadt spricht. Ziel = der Corso (/story); ist er
-- gerade leer, zeigt er seinen eigenen, einladenden Leerzustand.
-- tag 'city-evening': ersetzt nur den Abend-Push von gestern auf dem Gerät.
-- dedupe_key je Person und Corso-Tag: ein zweiter Lauf fügt nichts hinzu.
create or replace function enqueue_city_evening_push()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c        text;
  line     text;
  day      text := corso_day()::text;
  inserted int;
  total    int := 0;
begin
  for c in
    select distinct p.city
      from profiles p
     where p.push_enabled
       and exists (select 1 from push_subscriptions s where s.user_id = p.id)
  loop
    line := draw_city_evening_line(c);
    continue when line is null;

    insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
    select p.id,
           'city_evening',
           c,
           line,
           '/story',
           'city-evening',
           'city_evening:' || p.id::text || ':' || day
      from profiles p
     where p.city = c
       and p.push_enabled
       and exists (select 1 from push_subscriptions s where s.user_id = p.id)
       and not exists (
         select 1 from push_outbox o
          where o.user_id = p.id
            and o.kind = 'audience_expiring'
            and o.created_at >= corso_day_start()
       )
    on conflict (dedupe_key) do nothing;

    get diagnostics inserted = row_count;
    total := total + inserted;
  end loop;

  return total;
end;
$$;

revoke all on function enqueue_city_evening_push() from public;
revoke execute on function enqueue_city_evening_push() from anon, authenticated;

-- Cron-Hülle nach dem Muster aus 0018: zwei Slots, die Funktion prüft selbst
-- die Berliner Stunde → sommer-/winterzeitsicher, der falsche Slot läuft leer.
create or replace function run_city_evening_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 19 then
    return;
  end if;
  perform enqueue_city_evening_push();
end;
$$;

revoke all on function run_city_evening_push() from public;
revoke execute on function run_city_evening_push() from anon, authenticated;

-- ===========================================================================
-- 6. Dev-Menü: der echte Abend-Push, nur an mich
-- ===========================================================================
-- Gleicher Titel, gleicher Text (die Ziehung des Tages), gleiches Ziel wie um
-- 19:00. Zieht der Test vor 19:00, steht der Tages-Text damit schon fest —
-- die Stadt bekommt abends genau diesen Satz. Nach 21:00 gilt schon der
-- nächste Corso-Tag. Ignoriert die 18-Uhr-Ausnahme, damit Testen immer geht.
-- Wie alle Dev-Menü-Funktionen an dominik@subworx.io gebunden (0006).
create or replace function dev_menu_test_evening_push()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  devices int;
  my_city text;
  line    text;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;

  select count(*) into devices from push_subscriptions where user_id = auth.uid();
  if devices = 0 then
    return 'Kein Gerät angemeldet. Erst in den Einstellungen Push einschalten — auf dem iPhone nur aus der installierten App.';
  end if;

  select city into my_city from profiles where id = auth.uid();
  line := draw_city_evening_line(my_city);
  if line is null then
    return 'Die Textbank ist leer — kein aktiver Text für ' || my_city || '.';
  end if;

  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  values (
    auth.uid(),
    'city_evening',
    my_city,
    line,
    '/story',
    'city-evening',
    -- Sekundengenauer Schlüssel: mehrmals hintereinander testen muss gehen.
    'test_evening:' || auth.uid()::text || ':' || extract(epoch from now())::bigint::text
  );

  return 'Abend-Push unterwegs: „' || line || '" — kommt binnen einer Minute an.';
end;
$$;

revoke all on function dev_menu_test_evening_push() from public;
revoke all on function dev_menu_test_evening_push() from anon;
grant execute on function dev_menu_test_evening_push() to authenticated;

-- ===========================================================================
-- 7. Zeitplan — 19:00 Berlin
--   17:00 UTC = 19:00 Sommerzeit, 18:00 UTC = 19:00 Winterzeit.
--   cron.schedule() ist per Job-Name ein Upsert — Re-Run ist ungefährlich.
-- ===========================================================================
create extension if not exists pg_cron;

select cron.schedule('city-evening-summer', '0 17 * * *', 'select public.run_city_evening_push()');
select cron.schedule('city-evening-winter', '0 18 * * *', 'select public.run_city_evening_push()');

comment on function enqueue_city_evening_push() is
  'Abend-Push 19:00 Berlin (0036). Ein Text je Stadt und Corso-Tag aus city_evening_lines; übersprungen wird, wer an dem Corso-Tag schon audience_expiring bekam.';
