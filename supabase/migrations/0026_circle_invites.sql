-- Corso — 0026: Circle-Einladungs-Links (Entscheidung Dominik, 2. Sep 2026).
--
-- Jeder kann aus dem Circle-Tab einen persönlichen Link erzeugen und an Freunde
-- AUSSERHALB der App schicken. Wer den Link öffnet und (neu oder bestehend)
-- eingeloggt ist, landet direkt mit dem Einladenden zusammen im Circle.
--
-- ⚠️ Konzept-Hinweis: Das ist ein ZWEITER Eintrittsweg in den Circle, am
-- 5-Tage-Gegenseitigkeits-Ritual (0024) vorbei — bewusste Produkt-Entscheidung
-- (Freunde, die man eh schon hat, müssen sich den Circle nicht „erspielen").
-- In den Metriken bleiben beide Wege trennbar: chat_reached trägt hier
-- metadata.via = 'circle_invite' (der Trigger-Weg schreibt kein via).
--
-- 🔒 Leitplanken-Erbe aus 0024 gilt auch hier:
--   - Tokens sind nicht auflistbar (RLS ohne Policy + Grants entzogen,
--     Muster invites/0009) — Erzeugen/Einlösen NUR über DEFINER-RPCs.
--   - Block in irgendeine Richtung verhindert die Verbindung (stille Antwort
--     'invalid', kein Informations-Leck, wer wen blockiert).
--   - announced_a/b_at bleiben NULL → der CircleSplash feiert den Eintritt
--     bei beiden wie beim erspielten Weg.
--   - Einmal-Verwendung + 7-Tage-Ablauf (Muster Einladungs-Links).

create table circle_invites (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,
  inviter_id   uuid not null references profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  redeemed_at  timestamptz,
  redeemed_by  uuid references profiles (id) on delete set null
);

create index circle_invites_inviter_idx on circle_invites (inviter_id, created_at);

alter table circle_invites enable row level security;
-- KEINE Policies + Grants entzogen → Tokens nur über die RPCs unten erreichbar.
revoke all on circle_invites from public, anon, authenticated;

-- ===========================================================================
-- create_circle_invite() — neuen Link-Token erzeugen (nur für sich selbst)
-- ===========================================================================
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
  t := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into circle_invites (token, inviter_id) values (t, auth.uid());
  return t;
end;
$$;

revoke all on function create_circle_invite() from public, anon;
grant execute on function create_circle_invite() to authenticated;

-- ===========================================================================
-- circle_invite_inviter(p_token) — Anzeige-Daten für die Link-Landeseite
-- ===========================================================================
-- Der Worker (service_role) liest direkt; diese RPC existiert NICHT für
-- authenticated — die Landeseite läuft serverseitig. (Bewusst keine breitere
-- Lese-Oberfläche für Tokens.)

-- ===========================================================================
-- redeem_circle_invite(p_token) — Link einlösen: Circle-Verbindung stiften
-- ===========================================================================
create or replace function redeem_circle_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  inv  record;
  lo   uuid;
  hi   uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select id, inviter_id, expires_at, redeemed_at, redeemed_by
    into inv
    from circle_invites
   where token = p_token;

  if not found then
    return 'invalid';
  end if;
  if inv.inviter_id = me then
    return 'self'; -- eigener Link: nicht verbrennen, nur benennen
  end if;
  if inv.redeemed_at is not null then
    -- Von MIR bereits eingelöst → idempotent ok (Doppel-Tap, Reload).
    if inv.redeemed_by = me then
      return 'connected';
    end if;
    return 'used';
  end if;
  if inv.expires_at <= now() then
    return 'expired';
  end if;

  -- 🔒 Block in irgendeine Richtung: stille, unspezifische Antwort.
  if exists (
    select 1 from blocks b
    where (b.blocker_id = me and b.blocked_id = inv.inviter_id)
       or (b.blocker_id = inv.inviter_id and b.blocked_id = me)
  ) then
    return 'invalid';
  end if;

  -- Atomar beanspruchen (Race: zwei Geräte lösen gleichzeitig ein).
  update circle_invites
     set redeemed_at = now(), redeemed_by = me
   where id = inv.id and redeemed_at is null and expires_at > now();
  if not found then
    return 'used';
  end if;

  lo := least(me, inv.inviter_id);
  hi := greatest(me, inv.inviter_id);

  -- Verbindung stiften — exakt das 0024-Muster: on conflict do nothing, und
  -- chat_reached (Kill-Metrik „verdiente Chats") nur bei ECHTER Neuanlage,
  -- eine Zeile pro Person. via = 'circle_invite' hält die zwei Eintrittswege
  -- in der Auswertung trennbar. announced_a/b_at bleiben NULL → CircleSplash.
  with ins as (
    insert into connections (user_a_id, user_b_id)
    values (lo, hi)
    on conflict (user_a_id, user_b_id) do nothing
    returning id
  )
  insert into events (user_id, event_type, metadata)
  select u, 'chat_reached', jsonb_build_object('connection_id', ins.id, 'via', 'circle_invite')
  from ins, unnest(array[lo, hi]) as u;

  return 'connected';
end;
$$;

revoke all on function redeem_circle_invite(text) from public, anon;
grant execute on function redeem_circle_invite(text) to authenticated;
