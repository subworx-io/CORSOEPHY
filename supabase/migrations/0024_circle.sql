-- Corso — 0024: Der Circle (Achse 2 des Zwei-Achsen-Modells).
-- Bezug: Umbau-Auftrag Dominik (2. Sep 2026, als PRD-Eigner-Freigabe bestätigt),
-- PRD §4.8 (Verbindungs-Mechanik) — die offene Entscheidung #8 wird hiermit so
-- beantwortet: Zwei Menschen kommen in den Circle, wenn sie sich an mehreren
-- Corso-Tagen (Schwelle konfigurierbar, Default 5) GEGENSEITIG aktiv gefolgt
-- sind. Der Circle verfällt nie; der Chat lebt ausschließlich dort.
--
-- WIE DIE VERSTECKTE 5x-SCHWELLE ERFASST WIRD
--   Gegenseitigkeit bei beidseitig unabhängig verfallenden Follows ist ein
--   Intervall-Überlappungsproblem. Da aber jede Seite spätestens alle 24 h aktiv
--   handeln muss (folgen/erneuern), um aktiv zu bleiben, reicht es, im Moment
--   jeder Follow-Aktion zu prüfen, ob die Gegenrichtung gerade lebt — dann
--   existiert die Überlappung beweisbar, ohne Polling und ohne Cron.
--   Zählung: +1 pro Corso-Tag (21:00→21:00) und Paar, dedupliziert über ein
--   unique-Constraint. Lücken pausieren die Zählung, nichts wird zurückgesetzt.
--   (Abgestimmt mit Dominik: „max. 1x pro Tag, 5 Tage insgesamt, kein Reset";
--   Bestandsdaten zählen nicht — der Zähler startet mit dieser Migration bei 0.)
--
-- 🔒 LEITPLANKEN
--   - Der Zähler ist für KEINEN Client lesbar (RLS ohne Policy + Grants entzogen,
--     Muster invites/events): der Circle-Eintritt bleibt eine Überraschung.
--     Die Schwelle selbst liegt in app_config — ebenfalls unlesbar.
--   - Follower-Privatsphäre unberührt: die Erkennung läuft serverseitig im
--     Trigger (SECURITY DEFINER); kein Client kann die Gegenrichtung abfragen.
--   - Kein hartes DELETE: Follows und Momente verfallen weiter nur über
--     expires_at. Der Circle selbst verfällt nie (connections, wie seit 0003).
--   - Ein Block (0017) stoppt Anbahnung und Chat in beide Richtungen.

-- ===========================================================================
-- 1. app_config — kleine serverseitige Konfiguration (nicht client-lesbar)
-- ===========================================================================
create table if not exists app_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table app_config enable row level security;
-- KEINE Policies + Grants entzogen → nur postgres/service_role und
-- DEFINER-Funktionen lesen die Werte. Die Circle-Schwelle bleibt unsichtbar.
revoke all on app_config from public, anon, authenticated;

insert into app_config (key, value)
values ('circle_threshold', '5'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- 2. follow_mutual_days — der versteckte Gegenseitigkeits-Zähler
-- ===========================================================================
-- Eine Zeile = „an diesem Corso-Tag haben sich diese zwei gegenseitig aktiv
-- gefolgt". Kanonisches Paar (lo < hi), Dedupe pro Tag über das unique-Constraint.
create table follow_mutual_days (
  id          uuid primary key default gen_random_uuid(),
  user_lo     uuid not null references profiles (id) on delete cascade,
  user_hi     uuid not null references profiles (id) on delete cascade,
  corso_day   date not null default corso_day(),
  created_at  timestamptz not null default now(),
  check (user_lo < user_hi),
  unique (user_lo, user_hi, corso_day)
);

create index follow_mutual_days_pair_idx on follow_mutual_days (user_lo, user_hi);

alter table follow_mutual_days enable row level security;
-- 🔒 KEINE Policies + Grants entzogen: kein Client sieht den Zählerstand —
-- weder den eigenen noch fremde. Der Circle-Eintritt ist eine Überraschung.
revoke all on follow_mutual_days from public, anon, authenticated;

-- ===========================================================================
-- 3. connections — Ankündigungs-Stand pro Seite
-- ===========================================================================
-- Serverseitig statt localStorage: die Feier („Du hast jemand Neues in deinem
-- Circle") soll genau einmal pro Person erscheinen, nicht einmal pro Gerät.
alter table connections add column if not exists announced_a_at timestamptz;
alter table connections add column if not exists announced_b_at timestamptz;

-- ===========================================================================
-- 4. Trigger: Gegenseitigkeit erfassen + Circle bilden
-- ===========================================================================
create or replace function record_mutual_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lo        uuid;
  hi        uuid;
  threshold int;
  days      int;
begin
  -- Nur ein AKTIVER Follow stiftet Gegenseitigkeit. Entfolgen (expires_at =
  -- now()) und sonstige Updates an abgelaufenen Zeilen feuern nicht.
  if new.expires_at <= now() then
    return null;
  end if;

  -- Die Gegenrichtung muss JETZT aktiv sein — dann überlappen beide Follows
  -- beweisbar in diesem Moment. (DEFINER: RLS würde die Gegenrichtung sperren.)
  if not exists (
    select 1 from follows r
    where r.follower_id = new.followee_id
      and r.followee_id = new.follower_id
      and r.expires_at > now()
  ) then
    return null;
  end if;

  lo := least(new.follower_id, new.followee_id);
  hi := greatest(new.follower_id, new.followee_id);

  -- Bereits im Circle → nichts mehr zu zählen.
  if exists (select 1 from connections c where c.user_a_id = lo and c.user_b_id = hi) then
    return null;
  end if;

  -- Ein Block in irgendeine Richtung stoppt die Anbahnung still.
  if exists (
    select 1 from blocks b
    where (b.blocker_id = lo and b.blocked_id = hi)
       or (b.blocker_id = hi and b.blocked_id = lo)
  ) then
    return null;
  end if;

  -- +1 pro Corso-Tag und Paar — Dedupe über das unique-Constraint. Ein Tag mit
  -- zehnmal Entfolgen/Neu-Folgen zählt genau einmal (nicht ertricksbar).
  insert into follow_mutual_days (user_lo, user_hi, corso_day)
  values (lo, hi, corso_day(now()))
  on conflict (user_lo, user_hi, corso_day) do nothing;

  select (value #>> '{}')::int into threshold
  from app_config where key = 'circle_threshold';
  threshold := coalesce(threshold, 5);

  select count(*) into days
  from follow_mutual_days
  where user_lo = lo and user_hi = hi;

  if days >= threshold then
    -- Circle bilden. Das CTE stellt sicher, dass die chat_reached-Events nur
    -- bei ECHTER Neuanlage geschrieben werden (Race zweier paralleler Renewals).
    -- chat_reached war seit 0018 reserviert — der Chat wird jetzt exakt mit dem
    -- Circle-Eintritt erreicht (Kill-Metrik „verdiente Chats", Dedupe in der
    -- Auswertung über metadata.connection_id). Eine Zeile pro Person (Muster
    -- story_drawn). 🔒 metadata nur Referenz-ID, keine Zählerstände.
    with ins as (
      insert into connections (user_a_id, user_b_id)
      values (lo, hi)
      on conflict (user_a_id, user_b_id) do nothing
      returning id
    )
    insert into events (user_id, event_type, metadata)
    select u, 'chat_reached', jsonb_build_object('connection_id', ins.id)
    from ins, unnest(array[lo, hi]) as u;
  end if;

  return null;
end;
$$;

revoke all on function record_mutual_follow() from public, anon, authenticated;

drop trigger if exists follows_record_mutual on follows;
create trigger follows_record_mutual
  after insert or update on follows
  for each row execute function record_mutual_follow();

-- ===========================================================================
-- 5. acknowledge_circle() — Ankündigung als gesehen markieren (nur eigene Seite)
-- ===========================================================================
create or replace function acknowledge_circle(p_connection uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update connections
  set announced_a_at = case
        when user_a_id = auth.uid() then coalesce(announced_a_at, now())
        else announced_a_at
      end,
      announced_b_at = case
        when user_b_id = auth.uid() then coalesce(announced_b_at, now())
        else announced_b_at
      end
  where id = p_connection
    and (user_a_id = auth.uid() or user_b_id = auth.uid());
end;
$$;

revoke all on function acknowledge_circle(uuid) from public, anon;
grant execute on function acknowledge_circle(uuid) to authenticated;

-- ===========================================================================
-- 6. circle_messages — der verdiente Chat (lebt ausschließlich im Circle)
-- ===========================================================================
create table circle_messages (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references connections (id) on delete cascade,
  sender_id      uuid not null references profiles (id) on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);

create index circle_messages_conn_idx on circle_messages (connection_id, created_at);

alter table circle_messages enable row level security;

-- Lesen/Schreiben nur für die beiden Partner der Verbindung. Kein Update/Delete
-- (Pilot: Nachrichten sind, was sie sind).
create policy circle_messages_read on circle_messages
  for select to authenticated
  using (
    exists (
      select 1 from connections c
      where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy circle_messages_insert on circle_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from connections c
      where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- Block-Sperre in BEIDE Richtungen (RLS auf blocks zeigt dem Client nur die
-- eigene Richtung → Durchsetzung als DEFINER-Trigger, Muster nudges_block_guard).
-- Pinnt nebenbei created_at serverseitig.
create or replace function reject_message_if_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  partner uuid;
begin
  select case when c.user_a_id = new.sender_id then c.user_b_id else c.user_a_id end
  into partner
  from connections c
  where c.id = new.connection_id;

  if partner is null then
    raise exception 'no connection';
  end if;

  if exists (
    select 1 from blocks b
    where (b.blocker_id = new.sender_id and b.blocked_id = partner)
       or (b.blocker_id = partner and b.blocked_id = new.sender_id)
  ) then
    raise exception 'blocked';
  end if;

  new.created_at := now();
  return new;
end;
$$;

revoke all on function reject_message_if_blocked() from public, anon, authenticated;

create trigger circle_messages_block_guard
  before insert on circle_messages
  for each row execute function reject_message_if_blocked();

-- ===========================================================================
-- 7. Dev-Werkzeuge (nur Admin): Circle ohne 5 Tage Wartezeit testbar machen
-- ===========================================================================
-- Rückwirkende Gegenseitigkeits-Tage für das Paar (ich, Handle) eintragen.
-- Bildet den Circle NICHT selbst — der entsteht über den echten Trigger-Pfad
-- beim nächsten gegenseitigen Follow. So testet man die echte Mechanik.
create or replace function dev_menu_seed_circle_progress(p_other_handle text, p_days int default 4)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  other uuid;
  lo uuid;
  hi uuid;
  i int;
  total int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  select id into other from profiles where handle = p_other_handle;
  if other is null then
    return format('Handle %s nicht gefunden.', p_other_handle);
  end if;
  if other = auth.uid() then
    return 'Das bist du selbst.';
  end if;
  lo := least(auth.uid(), other);
  hi := greatest(auth.uid(), other);
  for i in 1..greatest(coalesce(p_days, 0), 0) loop
    insert into follow_mutual_days (user_lo, user_hi, corso_day)
    values (lo, hi, corso_day(now()) - i)
    on conflict (user_lo, user_hi, corso_day) do nothing;
  end loop;
  select count(*) into total from follow_mutual_days where user_lo = lo and user_hi = hi;
  return format(
    'Paar hat jetzt %s Gegenseitigkeits-Tage. Der Circle entsteht beim nächsten gegenseitigen Follow (Schwelle serverseitig).',
    total
  );
end;
$$;

revoke all on function dev_menu_seed_circle_progress(text, int) from public, anon;
grant execute on function dev_menu_seed_circle_progress(text, int) to authenticated;

-- Circle-Testdaten für das Paar (ich, Handle) entfernen: Verbindung (cascadet
-- auf Nachrichten) + Zähler. Nur Dev — im Produkt verfällt ein Circle nie.
create or replace function dev_menu_reset_circle(p_other_handle text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  other uuid;
  lo uuid;
  hi uuid;
  had_connection int;
begin
  if not is_dev_admin() then raise exception 'Nicht berechtigt'; end if;
  select id into other from profiles where handle = p_other_handle;
  if other is null then
    return format('Handle %s nicht gefunden.', p_other_handle);
  end if;
  lo := least(auth.uid(), other);
  hi := greatest(auth.uid(), other);
  delete from connections where user_a_id = lo and user_b_id = hi;
  get diagnostics had_connection = row_count;
  delete from follow_mutual_days where user_lo = lo and user_hi = hi;
  return format(
    'Circle-Stand für das Paar zurückgesetzt (%s Verbindung entfernt, Zähler geleert).',
    had_connection
  );
end;
$$;

revoke all on function dev_menu_reset_circle(text) from public, anon;
grant execute on function dev_menu_reset_circle(text) to authenticated;
