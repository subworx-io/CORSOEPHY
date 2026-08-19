-- Corso — Test-Push im Dev-Menü.
--
-- Ohne das lässt sich Push nur um 21:00 prüfen, und auf iOS auch nur auf dem
-- echten Gerät. Diese Aktion legt genau eine Outbox-Zeile für den Aufrufer an;
-- der minütliche dispatch_push()-Tick holt sie ab. Vom Tippen bis zum Klingeln
-- vergeht damit höchstens eine Minute.
--
-- Wie alle Dev-Menü-Funktionen an dominik@subworx.io gebunden (0006) und
-- serverseitig geprüft — nicht im Client.

create or replace function dev_menu_test_push()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  devices int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;

  select count(*) into devices from push_subscriptions where user_id = auth.uid();
  if devices = 0 then
    return 'Kein Gerät angemeldet. Erst in den Einstellungen Push einschalten — auf dem iPhone nur aus der installierten App.';
  end if;

  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  values (
    auth.uid(),
    'city_story',
    'Testlauf',
    'Wenn du das liest, kommt der 21:00-Push an.',
    '/story',
    'corso-test',
    -- Sekundengenauer Schlüssel: mehrmals hintereinander testen muss gehen.
    'test:' || auth.uid()::text || ':' || extract(epoch from now())::bigint::text
  );

  return devices || ' Gerät(e) angeschrieben. Kommt binnen einer Minute an.';
end;
$$;

revoke all on function dev_menu_test_push() from public;
revoke all on function dev_menu_test_push() from anon;
grant execute on function dev_menu_test_push() to authenticated;
