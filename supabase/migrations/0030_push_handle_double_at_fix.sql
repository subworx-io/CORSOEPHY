-- Corso — 0030: `@@handle` in Push-Titeln.
--
-- Gefunden beim Trigger-Beweis für den Chat-Push (4. Sep 2026): der Titel kam als
-- „@@dominik" heraus. Grund: `profiles.handle` ist MIT führendem @ gespeichert
-- (alle 148 Zeilen der Live-DB, und die UI rechnet auch damit — siehe
-- `partner.handle.replace(/^@/, "")` in circle.tsx), die Push-Funktionen setzen
-- aber noch eins davor.
--
-- Betrifft zwei Anlässe:
--   - `enqueue_new_moment_push()` aus 0018 — der Fehler ist seit August live,
--     jeder „jemand, dem du folgst, hat gepostet"-Push trug ihn im Titel.
--   - `enqueue_circle_message_push()` aus 0028/0029 — noch nie zugestellt,
--     der Fehler wurde vor dem ersten echten Push gefunden.
--
-- Fix in beiden: `'@' || ltrim(handle, '@')`. Damit stimmt der Titel unabhängig
-- davon, ob ein Handle mit oder ohne @ in der Tabelle steht — und ein späterer
-- Wechsel des Speicherformats bricht die Push-Texte nicht.
--
-- Sonst ändert sich an beiden Funktionen NICHTS: gleiche Adressaten, gleiche
-- Drosselung, gleiche dedupe_keys, gleiche 🔒 Leitplanken (keine Zahl, kein
-- Nachrichtentext).

-- ===========================================================================
-- 1. „jemand, dem ich folge, hat etwas gezeigt" (aus 0018)
-- ===========================================================================
create or replace function enqueue_new_moment_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_handle text;
  day text := corso_day()::text;
begin
  select handle into author_handle from profiles where id = new.author_id;
  if author_handle is null then
    return new;
  end if;

  insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
  select f.follower_id,
         'new_moment',
         '@' || ltrim(author_handle, '@'),
         'hat gerade einen Moment gezeigt.',
         '/connections',
         'moment:' || new.author_id::text,
         'new_moment:' || f.follower_id::text || ':' || new.id::text
    from follows f
    join profiles p on p.id = f.follower_id
   where f.followee_id = new.author_id
     and f.expires_at > now()
     and p.push_enabled
     and exists (select 1 from push_subscriptions s where s.user_id = f.follower_id)
     -- Drosselung, pro Empfänger und Zyklus (unverändert aus 0018)
     and (
       select count(*)
         from push_outbox o
        where o.user_id = f.follower_id
          and o.kind = 'new_moment'
          and o.created_at >= corso_day_start()
     ) < 3
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

-- ===========================================================================
-- 2. „jemand aus deinem Circle hat dir geschrieben" (aus 0028, gehärtet in 0029)
-- ===========================================================================
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
  -- Push darf das Schreiben einer Nachricht nie verhindern (Begründung in 0029).
  begin
    select case when c.user_a_id = new.sender_id then c.user_b_id else c.user_a_id end,
           case when c.user_a_id = new.sender_id then c.last_read_b_at else c.last_read_a_at end
      into partner, partner_read
      from connections c
     where c.id = new.connection_id;

    if partner is null then
      return new;
    end if;

    if partner_read is not null and partner_read > now() - interval '45 seconds' then
      return new;
    end if;

    select handle into sender_handle from profiles where id = new.sender_id;
    if sender_handle is null then
      return new;
    end if;

    insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
    select partner,
           'circle_message',
           '@' || ltrim(sender_handle, '@'),
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

    perform dispatch_push();
  exception
    when others then
      return new;
  end;

  return new;
end;
$$;

revoke all on function enqueue_circle_message_push() from public, anon, authenticated;
