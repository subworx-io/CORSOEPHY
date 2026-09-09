-- Corso — 0035: Medien und Antworten im Circle-Chat
-- Auftrag Dominik, 9. Sep 2026, freigegeben.
--
-- Drei Bausteine:
--   1. circle_messages um Nachrichtentyp, Anhang und Antwort-Bezug erweitern.
--   2. Ein EIGENER, PRIVATER Bucket `chat-media` mit Policies, die an die
--      Circle-Verbindung gekoppelt sind.
--   3. Push-Text je nach Sorte („hat dir ein Foto geschickt").
--
-- 🔒 WARUM EIN ZWEITER BUCKET SEIN MUSS
--   Der bestehende Bucket `moments` trägt die Policy
--     "moments: read authenticated"  →  using (bucket_id = 'moments')
--   Also: JEDER Eingeloggte darf dort ALLES lesen. Das ist für den
--   Discovery-Feed richtig (fremde Clips müssen sichtbar sein) und für
--   Chat-Medien fatal — eine signierte URL könnte sich jeder Angemeldete
--   selbst ausstellen. Signierte URLs sind hier KEINE Schutzschicht.
--   Chat-Medien liegen deshalb in einem eigenen Bucket, dessen SELECT-Policy
--   bei jedem Zugriff prüft, ob der Aufrufer einer der beiden Partner dieser
--   Verbindung ist. Durchgesetzt an der Storage-Ebene, nicht im Frontend.
--
-- 🔒 GALERIE-AUSNAHME — GILT AUSSCHLIESSLICH HIER
--   Für Chat-Medien ist Galerie-Upload erlaubt (Entscheidung Dominik: der Chat
--   ist ein privater Eins-zu-eins-Raum ohne Publikum; die Live-Kamera-Pflicht
--   richtet sich gegen Selbstinszenierung VOR DER STADT). Die Trennung ist
--   physisch: anderer Bucket, anderes Client-Modul, und `posts` wird von
--   diesem Pfad nie berührt. Der öffentliche Flow (use-camera.ts →
--   lib/supabase/upload.ts → Bucket `moments` → posts) bleibt unangetastet.
--
-- 🔒 UNVERÄNDERT: circle_messages_read/_insert (nur die beiden Partner),
--   der beidseitige Block-Guard, kein UPDATE/DELETE, kein Verfall.
--   Chat-Inhalte verfallen NICHT (Entscheidung Dominik) — der Circle ist die
--   beständige Achse (PRD §4.8), die 24h-Uhr gilt nur für öffentliche Momente.

-- ===========================================================================
-- 1. Nachrichtentyp, Anhang, Antwort-Bezug
-- ===========================================================================
alter table circle_messages
  add column if not exists kind text not null default 'text'
    check (kind in ('text', 'photo', 'video', 'voice')),
  add column if not exists attachment_path  text,
  add column if not exists attachment_mime  text,
  add column if not exists attachment_bytes integer,
  -- Video und Sprachnachricht: Länge in Millisekunden, für die Anzeige.
  add column if not exists duration_ms      integer,
  -- Foto/Video: Seitenverhältnis, damit die Blase beim Laden nicht springt.
  add column if not exists width            integer,
  add column if not exists height           integer,
  add column if not exists reply_to         uuid references circle_messages (id);

create index if not exists circle_messages_reply_idx on circle_messages (reply_to);

-- Der alte Check verlangte 1–2000 Zeichen NICHT-LEEREN Text. Eine reine
-- Foto- oder Sprachnachricht wäre damit strukturell nicht einfügbar gewesen.
-- Neu: Text darf leer sein, wenn ein Anhang dranhängt — aber leer UND ohne
-- Anhang bleibt verboten (sonst entstünden Geister-Nachrichten).
alter table circle_messages drop constraint if exists circle_messages_body_check;
alter table circle_messages add constraint circle_messages_body_check
  check (char_length(body) <= 2000);
alter table circle_messages add constraint circle_messages_has_content
  check (char_length(btrim(body)) > 0 or attachment_path is not null);
-- Eine Nachricht mit Sorte ≠ 'text' braucht auch wirklich einen Anhang.
alter table circle_messages add constraint circle_messages_kind_matches_attachment
  check ((kind = 'text') = (attachment_path is null));

-- ===========================================================================
-- 2. Integrität des Antwort-Bezugs
-- ===========================================================================
-- Ohne diese Prüfung könnte jemand eine Nachricht aus einer ANDEREN eigenen
-- Verbindung zitieren. Der Partner könnte das Zitat zwar nicht lesen (RLS auf
-- circle_messages lässt nur Mitglieder der jeweiligen Verbindung heran) — das
-- Zitat bliebe für ihn schlicht leer. Trotzdem ist das eine offene Flanke und
-- eine Quelle für kaputte Darstellung. Also: nur Nachrichten DERSELBEN
-- Verbindung sind zitierbar.
--
-- Body 1:1 aus 0024, ergänzt um den reply_to-Block. Der Trigger bleibt
-- derselbe (circle_messages_block_guard, BEFORE INSERT).
create or replace function reject_message_if_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  partner uuid;
  reply_conn uuid;
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

  -- NEU ggü. 0024: Zitat nur aus demselben Chat.
  if new.reply_to is not null then
    select m.connection_id into reply_conn
    from circle_messages m where m.id = new.reply_to;
    if reply_conn is null or reply_conn <> new.connection_id then
      raise exception 'reply target not in this conversation';
    end if;
  end if;

  new.created_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 3. Der private Bucket `chat-media`
-- ===========================================================================
-- Pfadschema:  <connection_id>/<sender_id>/<uuid>.<ext>
--   Segment 1 trägt die Verbindung → daran hängt die Lese-Berechtigung.
--   Segment 2 trägt den Absender  → daran hängt die Schreib-Berechtigung.
--
-- `public = false`: kein anonymer Zugriff, Lesen ausschließlich über signierte
-- URLs — und die kann nur ausstellen, wer die SELECT-Policy unten erfüllt.
--
-- Grenzwerte serverseitig am Bucket (Entscheidung Dominik):
--   Foto 10 MB · Video 60 s / 50 MB · Sprachnachricht 120 s / ~2 MB.
-- Die Dateigröße erzwingt der Bucket; die LÄNGE eines Videos kann nur der
-- Client prüfen (Metadaten) — serverseitig greift dort die Größe.
-- MIME-Liste bewusst großzügig: aus der iOS-Galerie kommen u.a. video/quicktime
-- (.mov) und image/heic. Eine enge Liste würde iPhone-Videos stumm abweisen.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 52428800,
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'video/mp4','video/quicktime','video/webm',
    'audio/webm','audio/mp4','audio/mpeg','audio/aac','audio/ogg'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lesen: nur die beiden Partner der Verbindung, die im Pfad steht.
drop policy if exists "chat-media: read members" on storage.objects;
create policy "chat-media: read members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1 from connections c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- Hochladen: nur in eine eigene Verbindung, und nur in den eigenen Unterordner.
drop policy if exists "chat-media: upload own" on storage.objects;
create policy "chat-media: upload own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from connections c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- Löschen: nur die eigene Datei. Gebraucht wird das ausschließlich zum
-- Aufräumen, wenn der Insert der Nachricht nach dem Upload scheitert —
-- Nachrichten selbst werden nie gelöscht (kein UPDATE/DELETE auf der Tabelle).
drop policy if exists "chat-media: delete own" on storage.objects;
create policy "chat-media: delete own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ===========================================================================
-- 4. Push-Text je nach Sorte
-- ===========================================================================
-- 🔒 Weiterhin KEIN Inhalt und KEINE Zahl — nur, WAS für eine Art Nachricht
-- angekommen ist. Body 1:1 aus der Live-Fassung (0029 Exception-Schutz +
-- 0030 @-Fix), geändert ist ausschließlich die eine Textzeile.
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
  what          text;
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

    what := case new.kind
              when 'photo' then 'hat dir ein Foto geschickt.'
              when 'video' then 'hat dir ein Video geschickt.'
              when 'voice' then 'hat dir eine Sprachnachricht geschickt.'
              else 'hat dir geschrieben.'
            end;

    insert into push_outbox (user_id, kind, title, body, url, tag, dedupe_key)
    select partner,
           'circle_message',
           '@' || ltrim(sender_handle, '@'),
           what,
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

comment on table circle_messages is
  'Circle-Chat. Verfällt NIE (der Circle ist die beständige Achse, PRD §4.8) — die 24h-Uhr gilt nur für öffentliche Momente. Anhänge liegen im privaten Bucket chat-media, Pfad <connection_id>/<sender_id>/<uuid>.';
