-- Corso — Freitext-Broadcast aus dem Dev-Menü.
--
-- Zweck: eine selbst getippte Nachricht an alle erreichbaren Nutzer schicken.
-- Gedacht für den Freundes-Pilot („Heute Abend geht's los") und zum Prüfen,
-- ob Push bei allen wirklich ankommt — nicht als Marketing-Kanal.
--
-- 🔒 Wie alle Dev-Menü-Funktionen an dominik@subworx.io gebunden (0006) und
-- serverseitig geprüft. Ein Broadcast erreicht jeden angemeldeten Menschen in
-- der Stadt; das ist bewusst die am strengsten bewachte Funktion der App.
--
-- ⚠️ Der Text ist frei — und landet auf fremden Sperrbildschirmen. Was für
-- Umstehende lesbar wäre, gehört nicht hinein: keine Follower- oder
-- Zuschauerzahlen, keine Namen Dritter. Das kann keine Prüfung erzwingen,
-- deshalb steht die Warnung auch im Dev-Menü direkt über dem Eingabefeld.

-- 'broadcast' als vierte Sorte zulassen.
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('city_story', 'new_moment', 'audience_expiring', 'broadcast'));

create or replace function dev_menu_broadcast_push(
  p_title text,
  p_body  text,
  p_url   text default '/'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  reached int;
  stamp   text := extract(epoch from clock_timestamp())::bigint::text;
  target  text := coalesce(nullif(btrim(p_url), ''), '/');
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;

  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_body), '') = '' then
    raise exception 'Titel und Text dürfen nicht leer sein.';
  end if;
  if char_length(p_title) > 60 or char_length(p_body) > 180 then
    raise exception 'Zu lang: Titel höchstens 60, Text höchstens 180 Zeichen.';
  end if;
  -- Nur App-interne Ziele. Ein Push, der aus der App herausführt, wäre ein
  -- Weiterleitungs-Werkzeug, kein Produktfeature.
  if left(target, 1) <> '/' then
    raise exception 'Ziel muss ein App-Pfad sein und mit / beginnen.';
  end if;

  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select p.id,
         'broadcast',
         btrim(p_title),
         btrim(p_body),
         target,
         -- Eigener tag pro Broadcast: zwei Nachrichten sollen sich nicht
         -- gegenseitig vom Sperrbildschirm verdrängen.
         'broadcast:' || stamp,
         'broadcast:' || p.id::text || ':' || stamp
    from profiles p
   where p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = p.id);

  get diagnostics reached = row_count;

  if reached = 0 then
    return 'Niemand erreichbar — es hat noch keiner Push eingeschaltet.';
  end if;
  return reached || ' Person(en) angeschrieben. Kommt binnen einer Minute an.';
end;
$$;

revoke all on function dev_menu_broadcast_push(text, text, text) from public;
revoke all on function dev_menu_broadcast_push(text, text, text) from anon;
grant execute on function dev_menu_broadcast_push(text, text, text) to authenticated;
