-- Corso — Vorab-Push 15 Minuten vor der Ziehung (20:45 Berlin).
--
-- Entscheidung 21. Aug 2026 (Dominik): Neben dem Ritual-Push um 21:01 (0018)
-- bekommt jeder, der Push eingeschaltet hat, um 20:45 einen Hinweis, dass die
-- Ziehung bevorsteht — Zeit, noch einen Moment aufzunehmen oder sich zum
-- Countdown einzufinden. Der Story-Screen zeigt ab 20:45 passend dazu den
-- Vorhang mit dem Countdown statt der auslaufenden Stadt Corso (story.tsx).
--
-- 🔒 Wie in 0018: kein Push-Text enthält jemals eine Zahl über Publikum oder
-- Zuschauer. Der Text steht serverseitig hier, nicht im Client.
--
-- Gleicher Benachrichtigungs-tag wie der Ritual-Push ('city-story'): um 21:01
-- ERSETZT der Ritual-Push diesen Hinweis auf dem Sperrbildschirm, statt sich
-- darunterzustapeln. Niemand soll zwei Corso-Zeilen übereinander vorfinden.

-- 'city_story_soon' als weitere Sorte zulassen (0020 hat 'broadcast' ergänzt).
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('city_story', 'city_story_soon', 'new_moment', 'audience_expiring', 'broadcast'));

-- Adressat: jeder, der Push will und ein Gerät angemeldet hat — wie beim
-- Ritual-Push. dedupe_key pro Person und Corso-Tag; um 20:45 ist corso_day()
-- noch der auslaufende Tag, eindeutig ist er trotzdem.
create or replace function enqueue_city_story_soon_push()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
  day text := corso_day()::text;
begin
  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select distinct
         p.id,
         'city_story_soon',
         'Gleich geht deine Stadt spazieren',
         'Um 21:00 wird der Stadt Corso gezogen. Noch 15 Minuten für deinen Moment.',
         '/story',
         'city-story',
         'city_story_soon:' || p.id::text || ':' || day
    from profiles p
   where p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = p.id)
  on conflict (dedupe_key) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function enqueue_city_story_soon_push() from public;
revoke execute on function enqueue_city_story_soon_push() from anon, authenticated;

-- Cron-Wrapper nach dem Muster aus 0015/0018: zwei Slots (Sommer-/Winterzeit),
-- die Funktion prüft selbst die Berliner Stunde → DST-sicher, der „falsche"
-- Slot läuft leer durch. Beide Slots liegen auf Minute 45, also 20:45 Berlin.
create or replace function run_city_story_soon_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 20 then
    return;
  end if;
  perform enqueue_city_story_soon_push();
end;
$$;

revoke all on function run_city_story_soon_push() from public;
revoke execute on function run_city_story_soon_push() from anon, authenticated;

-- Zeitplan. cron.schedule() ist per Job-Name ein Upsert — Re-Run ungefährlich.
-- Der Versand selbst läuft über den minütlichen dispatch_push()-Tick aus 0018.
select cron.schedule('city-story-soon-summer', '45 18 * * *', 'select public.run_city_story_soon_push()');
select cron.schedule('city-story-soon-winter', '45 19 * * *', 'select public.run_city_story_soon_push()');
