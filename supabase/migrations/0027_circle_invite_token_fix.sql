-- Corso — 0027: Fix für create_circle_invite() aus 0026.
-- gen_random_bytes() (pgcrypto) liegt bei Supabase im Schema `extensions`;
-- der search_path-Pin auf `public` verdeckte es → Laufzeitfehler beim ersten
-- echten Aufruf. Schema explizit qualifizieren (Rest der Funktion unverändert).

create or replace function create_circle_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  recent int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Sanfte Bremse gegen Token-Spam (jeder Share-Tap erzeugt einen Token).
  select count(*) into recent
  from circle_invites
  where inviter_id = auth.uid() and created_at > now() - interval '1 day';
  if recent >= 30 then
    raise exception 'Zu viele Circle-Links heute — morgen wieder.';
  end if;

  -- URL-sicheres Token: base64 → base64url-Alphabet, Padding entfernt.
  t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into circle_invites (token, inviter_id) values (t, auth.uid());
  return t;
end;
$$;

revoke all on function create_circle_invite() from public, anon;
grant execute on function create_circle_invite() to authenticated;
