-- Corso — Einladungs-Links für den Freundes-Pilot (E-Mail-frei)
--
-- ⚠️ PILOT-PROVISORIUM. Bewusste Übergangslösung mit Verfallsdatum, KEINE dauerhafte
-- Auth-Architektur. Der spätere zahlende Fremden-Pilot bekommt echte Self-Service-
-- Registrierung. Diese Tabelle + die Einlöse-Route (src/lib/invites/) sind wegwerfbar
-- und dürfen NICHT als Fundament für dauerhaftes Auth weiterbenutzt werden.
-- Siehe docs/STATUS.md.
--
-- 🔒 Nur serverseitig (service_role) les-/schreibbar: RLS an, KEINE Policy für
--    anon/authenticated + alle Grants entzogen → kein Client-Zugriff, Tokens sind
--    weder auflistbar noch erratbar (kryptografisch zufällig, im Skript erzeugt).

create table if not exists invites (
  id           uuid primary key default gen_random_uuid(),
  token        text unique not null,          -- kryptografisch zufälliges Geheimnis im Link
  friend_name  text not null,                 -- für wen der Link ist (Übersicht für Maxim)
  friend_email text not null,                 -- echte E-Mail → Konto später per Mail wiederherstellbar
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days'),  -- 🔒 Ablauf (7 Tage)
  redeemed_at  timestamptz null,              -- 🔒 gesetzt = eingelöst (einmalig verwendbar)
  redeemed_by  uuid null references auth.users (id) on delete set null
);

create index if not exists invites_token_idx on invites (token);

-- 🔒 Zugriffssperre: RLS an, bewusst KEINE Policy (default-deny für anon/authenticated),
--    zusätzlich alle Tabellen-Grants entziehen. Nur service_role (umgeht RLS) kommt ran.
alter table invites enable row level security;
revoke all on invites from anon, authenticated;
