-- Corso — 0028: Der Circle-Chat wird live.
-- Bezug: Backlog Dominik #18/#21/#22 (4. Sep 2026).
--
-- Drei Bausteine, alle rund um circle_messages (0024):
--   1. Realtime — die Tabelle in die supabase_realtime-Publication, damit der
--      Chat ohne 4-Sekunden-Polling ankommt (#18) und die App eine neue
--      Nachricht sofort melden kann (#21).
--   2. Lese-Stand — last_read_a_at / last_read_b_at an connections, damit der
--      „ungelesen"-Punkt geräteübergreifend stimmt (Entscheidung Dominik:
--      serverseitig, nicht localStorage). Muster wie announced_a_at (0024).
--   3. Push — vierter Anlass `circle_message` in der Outbox aus 0018 (#22).
--
-- 🔒 LEITPLANKEN
--   - Der Push-Text enthält KEINEN Nachrichteninhalt und KEINE Zahl
--     (Entscheidung Dominik: nur „@handle hat dir geschrieben."). Push-Texte
--     stehen auf dem Sperrbildschirm — was im Chat privat ist, bleibt privat.
--     Die Texte leben deshalb wie die anderen drei Anlässe serverseitig hier.
--   - Realtime läuft unter RLS: circle_messages_read (0024) lässt nur die
--     beiden Partner einer Verbindung an die Zeilen. Ein Abonnent bekommt
--     ausschließlich Nachrichten aus seinen eigenen Verbindungen.
--   - Ein Block sperrt weiterhin serverseitig (circle_messages_block_guard) —
--     was gar nicht erst eingefügt wird, löst auch keinen Push aus.
--   - Der Lese-Stand ist NUR über mark_circle_read() schreibbar (connections
--     hat keine UPDATE-Policy) und nur für die eigene Seite.

-- ===========================================================================
-- 1. Realtime für circle_messages
-- ===========================================================================
-- Idempotent: die Publication existiert in jedem Supabase-Projekt, die Tabelle
-- darf aber nur einmal drin sein — ein zweiter Lauf soll nicht scheitern.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'circle_messages'
     )
  then
    execute 'alter publication supabase_realtime add table public.circle_messages';
  end if;
end;
$$;

-- ===========================================================================
-- 2. Lese-Stand pro Seite
-- ===========================================================================
alter table connections add column if not exists last_read_a_at timestamptz;
alter table connections add column if not exists last_read_b_at timestamptz;

-- Setzt den eigenen Lese-Stand auf jetzt. DEFINER, weil connections bewusst nur
-- eine SELECT-Policy hat (0003) — geschrieben wird ausschließlich hier, und nur
-- an der Seite, auf der der Aufrufer selbst steht.
create or replace function mark_circle_read(p_connection uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update connections
     set last_read_a_at = case when user_a_id = auth.uid() then now() else last_read_a_at end,
         last_read_b_at = case when user_b_id = auth.uid() then now() else last_read_b_at end
   where id = p_connection
     and (user_a_id = auth.uid() or user_b_id = auth.uid());
end;
$$;

revoke all on function mark_circle_read(uuid) from public, anon;
grant execute on function mark_circle_read(uuid) to authenticated;

-- Posteingang: pro eigener Verbindung die jüngste Nachricht und ob sie
-- ungelesen ist. Eine Zeile pro Verbindung statt „alle Nachrichten holen und im
-- Client gruppieren" — der Punkt an der Nav soll nichts kosten.
--
-- SECURITY INVOKER (Default): RLS greift, der Aufrufer sieht nur seine eigenen
-- Verbindungen. Kein DEFINER — hier gibt es nichts zu umgehen.
create or replace function circle_inbox()
returns table (
  connection_id   uuid,
  partner_id      uuid,
  last_message_at timestamptz,
  last_sender_id  uuid,
  unread          boolean
)
language sql
stable
set search_path = public
as $$
  select c.id,
         case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end,
         m.created_at,
         m.sender_id,
         coalesce(
           m.sender_id is distinct from auth.uid()
           and (
             case when c.user_a_id = auth.uid() then c.last_read_a_at else c.last_read_b_at end
               is null
             or m.created_at >
                case when c.user_a_id = auth.uid() then c.last_read_a_at else c.last_read_b_at end
           ),
           false
         )
    from connections c
    left join lateral (
      select msg.sender_id, msg.created_at
        from circle_messages msg
       where msg.connection_id = c.id
       order by msg.created_at desc
       limit 1
    ) m on true
   where c.user_a_id = auth.uid() or c.user_b_id = auth.uid();
$$;

revoke all on function circle_inbox() from public, anon;
grant execute on function circle_inbox() to authenticated;

-- ===========================================================================
-- 3. Push-Anlass 4 — „jemand aus deinem Circle hat dir geschrieben"
-- ===========================================================================
-- Constraint austauschen statt eine zweite danebenzustellen (Name ist der von
-- Postgres vergebene Default). Die Liste ist über 0018 → 0020 ('broadcast') →
-- 0022 ('city_story_soon') gewachsen — sie muss hier VOLLSTÄNDIG wiederholt
-- werden, sonst reißt der neue Check die Bestandszeilen mit.
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('city_story', 'city_story_soon', 'new_moment', 'audience_expiring',
                  'broadcast', 'circle_message'));

create or replace function enqueue_circle_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  partner       uuid;
  sender_handle text;
  partner_read  timestamptz;
begin
  select case when c.user_a_id = new.sender_id then c.user_b_id else c.user_a_id end,
         case when c.user_a_id = new.sender_id then c.last_read_b_at else c.last_read_a_at end
    into partner, partner_read
    from connections c
   where c.id = new.connection_id;

  if partner is null then
    return new;
  end if;

  -- Sitzt die Gegenseite gerade IM Chat, hat sie eben erst gelesen — dann ist
  -- ein Sperrbildschirm-Hinweis Lärm, die Nachricht kommt ohnehin live an.
  if partner_read is not null and partner_read > now() - interval '45 seconds' then
    return new;
  end if;

  select handle into sender_handle from profiles where id = new.sender_id;
  if sender_handle is null then
    return new;
  end if;

  -- 🔒 Kein Nachrichtentext, keine Zahl — nur wer geschrieben hat.
  -- Drosselung: höchstens ein Push je Verbindung und 2 Minuten. Ein schneller
  -- Schlagabtausch soll nicht zwanzig Mal aufblinken; der `tag` sorgt zusätzlich
  -- dafür, dass eine neue Meldung die alte auf dem Gerät ersetzt.
  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select partner,
         'circle_message',
         '@' || sender_handle,
         'hat dir geschrieben.',
         '/circle?chat=' || new.sender_id::text,
         'chat:' || new.connection_id::text,
         'circle_message:' || new.connection_id::text || ':' || new.sender_id::text || ':'
           || (floor(extract(epoch from now()) / 120))::bigint::text
    from profiles p
   where p.id = partner
     and p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = partner)
     and not exists (
       select 1 from push_outbox o
        where o.user_id = partner
          and o.kind = 'circle_message'
          and o.tag = 'chat:' || new.connection_id::text
          and o.created_at > now() - interval '2 minutes'
     )
  on conflict (dedupe_key) do nothing;

  -- Der minütliche Cron aus 0018 reicht für ein 21:00-Ritual, nicht für einen
  -- Chat. Direkt anstupsen — pg_net stellt den Aufruf nur in seine Queue, der
  -- INSERT wartet also auf kein Netzwerk. Ohne Outbox-Zeile läuft der Aufruf
  -- selbst leer durch (dispatch_push prüft das als erstes).
  perform dispatch_push();

  return new;
end;
$$;

revoke all on function enqueue_circle_message_push() from public, anon, authenticated;

drop trigger if exists circle_messages_push on circle_messages;
create trigger circle_messages_push
  after insert on circle_messages
  for each row
  execute function enqueue_circle_message_push();
