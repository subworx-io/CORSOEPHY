-- Corso — 0029: Der Chat-Push darf das Schreiben einer Nachricht nie verhindern.
--
-- Nachtrag zu 0028. Dort hängt `enqueue_circle_message_push()` als AFTER-INSERT-
-- Trigger an circle_messages und ruft am Ende `dispatch_push()`, damit ein Chat
-- nicht bis zu einer Minute auf den pg_cron-Tick wartet.
--
-- Das Problem daran: ein AFTER-Trigger läuft in derselben Transaktion wie der
-- INSERT. Wirft irgendetwas am Push-Pfad eine Exception — pg_net nicht geladen,
-- Vault-Secret gelöscht, push_outbox gesperrt, ein künftiger Constraint —, dann
-- rollt die Transaktion zurück und die NACHRICHT ist weg. Der Nutzer sieht
-- „Nachricht konnte nicht gesendet werden", weil eine Benachrichtigung nicht
-- ging. Das ist die falsche Rangfolge: Die Nachricht ist das Produkt, der Push
-- ist die Beigabe.
--
-- Deshalb: der ganze Push-Teil in einen eigenen Block mit `exception when others`.
-- Scheitert er, bleibt die Nachricht trotzdem stehen und kommt per Realtime an;
-- verloren geht nur die Benachrichtigung. Bewusst still (kein `raise`): der
-- Absender kann daran nichts ändern, und ein Fehler im Log hilft ihm nicht.
--
-- Nur der Funktionsrumpf ändert sich, der Trigger aus 0028 bleibt hängen.

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
  exception
    when others then
      -- Push kaputt ist ein schlechter Tag, keine verlorene Nachricht.
      return new;
  end;

  return new;
end;
$$;

revoke all on function enqueue_circle_message_push() from public, anon, authenticated;
