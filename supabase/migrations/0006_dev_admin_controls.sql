-- Corso — Dev-Steuerung (nur Admin) + Absicherung der Roh-Funktionen aus 0005
--
-- Sicherheits-Hintergrund: Supabase vergibt per ALTER DEFAULT PRIVILEGES auf neue
-- Funktionen automatisch EXECUTE an anon/authenticated. Mein `revoke from public`
-- in 0005 hat diese EXPLIZITEN Grants NICHT entfernt → draw_city_story / dev_seed /
-- dev_clear waren faktisch für jeden eingeloggten (sogar anon) aufrufbar.
-- Hier: Roh-Funktionen zusperren + saubere, Admin-gegatete Wrapper fürs Dev-Menü.

-- ---------------------------------------------------------------------------
-- 1. Admin-Check: ist der aktuelle Nutzer der Dev-Admin?
--    Autoritativ über auth.users (nicht über evtl. fehlende JWT-Claims).
-- ---------------------------------------------------------------------------
create or replace function is_dev_admin()
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email = 'dominik@subworx.io'
  )
$$;

revoke all on function is_dev_admin() from public;
grant execute on function is_dev_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Roh-Funktionen zusperren — nur postgres/service_role (intern/Cron) dürfen.
--    Die Wrapper unten (SECURITY DEFINER, owner=postgres) rufen sie weiterhin auf.
-- ---------------------------------------------------------------------------
revoke execute on function draw_city_story(text, boolean)   from anon, authenticated;
revoke execute on function run_city_story_draw()            from anon, authenticated;
revoke execute on function dev_seed_city_story(int[])       from anon, authenticated;
revoke execute on function dev_clear_city_story_test()      from anon, authenticated;
revoke execute on function expire_follows()                 from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Dev-Menü-Wrapper — jeweils Admin-gegatet, an authenticated grantbar.
--    Rückgabe ist eine deutsche Klartext-Meldung fürs Toast im UI.
-- ---------------------------------------------------------------------------

-- 3a) Stadt-Story jetzt (neu) ziehen — aus echten heutigen einwilligenden Clips.
create or replace function dev_menu_draw_story()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare c text; n int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  select coalesce(city, 'Düsseldorf') into c from profiles where id = auth.uid();
  c := coalesce(c, 'Düsseldorf');
  n := draw_city_story(c, true);   -- force=true: neu ziehen (Test)
  return format('Stadt-Story für %s neu gezogen: %s Momente eingefroren.', c, n);
end $$;
revoke all on function dev_menu_draw_story() from public;
grant execute on function dev_menu_draw_story() to authenticated;

-- 3b) Stadt-Story heute zurücksetzen (Slots leeren → Leerzustand / neu ziehbar).
create or replace function dev_menu_clear_story()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare c text; n int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  select coalesce(city, 'Düsseldorf') into c from profiles where id = auth.uid();
  c := coalesce(c, 'Düsseldorf');
  delete from city_story_slots where story_date = corso_day(now()) and city = c;
  get diagnostics n = row_count;
  return format('Stadt-Story für %s heute geleert: %s Slots entfernt.', c, n);
end $$;
revoke all on function dev_menu_clear_story() from public;
grant execute on function dev_menu_clear_story() to authenticated;

-- 3c) Meine Follows verfallen lassen — simuliert den 08:00-Reset für dich.
create or replace function dev_menu_expire_my_follows()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  update follows set expires_at = now()
    where follower_id = auth.uid() and expires_at is null;
  get diagnostics n = row_count;
  return format('%s deiner Follows als verfallen markiert (08:00-Reset simuliert).', n);
end $$;
revoke all on function dev_menu_expire_my_follows() from public;
grant execute on function dev_menu_expire_my_follows() to authenticated;

-- 3d) Fake-Test-Clips seeden — damit die Story solo testbar ist. ACHTUNG:
--     erzeugt synthetische Clips, die real in der Story auftauchen können, bis
--     sie mit 3e wieder entfernt werden. Nur Dev.
create or replace function dev_menu_seed_test_clips()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  return dev_seed_city_story('{0,0,1,3,8,20,60,150}');
end $$;
revoke all on function dev_menu_seed_test_clips() from public;
grant execute on function dev_menu_seed_test_clips() to authenticated;

-- 3e) Fake-Test-Daten wieder löschen (synthetische Konten + deren Posts/Slots).
create or replace function dev_menu_clear_test_clips()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  return dev_clear_city_story_test();
end $$;
revoke all on function dev_menu_clear_test_clips() from public;
grant execute on function dev_menu_clear_test_clips() to authenticated;
