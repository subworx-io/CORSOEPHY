-- Corso — Push-Abos (Web Push nach RFC 8291/8292, VAPID).
--
-- Kontext: Roadmap Phase 1, letzter offener Punkt. Der Push ist der einzige
-- strukturelle Grund zurückzukommen — ohne ihn ist die Kill-Metrik
-- „Daily-Open-Rate ≥ 50 %" nicht fair messbar.
--
-- Diese Migration legt NUR die Abo-Verwaltung an (wer darf angeschrieben
-- werden, an welchen Endpunkt). Die Anlässe (21:00-Ritual, neuer Moment einer
-- gefolgten Person, ablaufendes Publikum) und der Versand folgen in 0017.
--
-- Ein Datensatz = ein Gerät/Browser, nicht ein Mensch. Dieselbe Person hat auf
-- iPhone-PWA und Desktop je ein eigenes Abo. Schlüssel ist deshalb der
-- endpoint, nicht die user_id.
--
-- 🔒 Privatsphäre: Ein Abo ist ausschließlich für seinen Besitzer sichtbar.
-- Der endpoint ist ein Geräte-Identifikator — er darf nie an andere Nutzer
-- auslesbar sein, auch nicht indirekt über eine Zählung. Es gibt bewusst
-- keine Policy, die fremde Zeilen sichtbar macht. Der Versender liest die
-- Tabelle mit service_role in der Edge Function, nicht per Client-Query.
--
-- Verhältnis zu profiles.push_enabled (0014): push_enabled ist die *Absicht*
-- des Nutzers ("ich will Push"), das Abo hier ist die *technische Erlaubnis*
-- des Browsers. Beides muss zutreffen, damit gesendet wird. Sie können
-- auseinanderlaufen — iOS wirft Abos bei Neuinstallation der PWA weg, ohne
-- dass der Nutzer etwas ändert. Deshalb re-synchronisiert der Client sein Abo
-- bei jedem Start.

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  -- Der Push-Dienst-Endpunkt (Apple/Google/Mozilla). Global eindeutig: wechselt
  -- auf einem Gerät der Account, wandert dasselbe Abo zum neuen Nutzer.
  endpoint      text not null unique,
  -- Die beiden Schlüssel aus PushSubscription.getKey() — nötig für die
  -- Ende-zu-Ende-Verschlüsselung der Nutzlast (RFC 8291). Ohne sie kann selbst
  -- der Server den Inhalt nicht zustellen.
  p256dh        text not null,
  auth          text not null,
  -- Nur zur Diagnose im Pilot ("kam der Push auf iOS an?"). Kein Tracking.
  user_agent    text,
  created_at    timestamptz not null default now(),
  -- Vom Client bei jedem App-Start aufgefrischt. Ein Abo, das lange nicht mehr
  -- gesehen wurde, ist wahrscheinlich tot.
  last_seen_at  timestamptz not null default now(),
  -- Aufeinanderfolgende Zustellfehler. Bei 404/410 (Abo widerrufen) löscht der
  -- Versender die Zeile sofort; dieser Zähler fängt die weichen Fehler ab.
  failure_count int not null default 0
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- RLS — jeder sieht und ändert ausschließlich seine eigenen Abos.
-- ---------------------------------------------------------------------------
alter table push_subscriptions enable row level security;

create policy push_subs_read_own   on push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subs_delete_own on push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- Bewusst KEINE insert/update-Policy: das Anlegen läuft ausschließlich über
-- save_push_subscription() unten. Grund: beim Account-Wechsel auf demselben
-- Gerät muss eine fremde Zeile übernommen werden — das ginge unter einer
-- Self-Policy nicht, und eine Policy, die fremde Zeilen beschreibbar macht,
-- wäre die falsche Antwort darauf.

-- ---------------------------------------------------------------------------
-- save_push_subscription — Abo anlegen oder auffrischen.
--
-- SECURITY DEFINER, damit der Endpunkt-Konflikt (Gerät wechselt Account)
-- aufgelöst werden kann. Der Nutzer wird NIE aus einem Argument gelesen,
-- immer aus auth.uid() — es gibt bewusst keinen Weg, ein Abo für jemand
-- anderen zu registrieren.
-- ---------------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Unvollständiges Push-Abo.';
  end if;

  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (endpoint) do update
     set user_id       = uid,
         p256dh        = excluded.p256dh,
         auth          = excluded.auth,
         user_agent    = excluded.user_agent,
         last_seen_at  = now(),
         failure_count = 0;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public;
revoke all on function public.save_push_subscription(text, text, text, text) from anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_push_subscription — Abo abmelden (Switch aus, Abmelden).
--
-- Läuft bewusst ohne SECURITY DEFINER über die RLS-Delete-Policy: hier gibt es
-- keinen Grund, fremde Zeilen anfassen zu dürfen.
-- ---------------------------------------------------------------------------
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
as $$
  delete from push_subscriptions
   where endpoint = p_endpoint
     and user_id = auth.uid();
$$;

revoke all on function public.delete_push_subscription(text) from public;
revoke all on function public.delete_push_subscription(text) from anon;
grant execute on function public.delete_push_subscription(text) to authenticated;
