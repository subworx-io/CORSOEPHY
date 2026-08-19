-- 0017_report_block.sql
-- Report + Block: Sicherheits-Grundausstattung vor dem Fremden-Pilot.
-- Block wird SERVERSEITIG durchgesetzt (RLS-Policy + SECURITY-DEFINER-RPC + Trigger),
-- nie nur im Frontend. Der posts-Filter kommt ADDITIV obendrauf auf Consent/24h-Verfall.
-- reports ist write-only für Nutzer (RLS an, keine Lese-Policy) — nur service_role sieht sie.

-- ── blocks ────────────────────────────────────────────────────────────────
create table blocks (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references profiles (id) on delete cascade,
  blocked_id  uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table blocks enable row level security;

-- Der Blocker sieht/verwaltet nur eigene Zeilen (Einstellungs-Liste + Entblocken).
-- Der Blockierte sieht die Zeile NIE (still/einseitig).
create policy blocks_read_own   on blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert_own on blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy blocks_delete_own on blocks for delete to authenticated using (blocker_id = auth.uid());

create index blocks_blocker_idx on blocks (blocker_id);
create index blocks_blocked_idx on blocks (blocked_id);

-- ── reports (write-only, Muster wie post_views in 0010) ─────────────────────
create table reports (
  id                  uuid primary key default gen_random_uuid(),
  reporter_id         uuid not null references profiles (id) on delete cascade,
  reported_user_id    uuid not null references profiles (id) on delete cascade,
  reported_post_id    uuid references posts (id) on delete set null,   -- Moment darf verfallen
  reason              text not null check (reason in ('inappropriate','harassment','spam','other')),
  note                text,
  status              text not null default 'open' check (status in ('open','handled')),
  -- Denormalisierter Snapshot: Moment verschwindet nach 24h, Betreiber muss trotzdem sichten.
  reported_media_path text,
  reported_handle     text,
  created_at          timestamptz not null default now()
);

alter table reports enable row level security;
-- KEINE Lese-Policy → kein Nutzer liest reports (auch nicht eigene). Nur service_role/SQL.
-- KEINE direkte Insert-Policy → Schreiben ausschließlich über report_content() (DEFINER),
-- damit reporter_id + Snapshot serverseitig gepinnt und nicht fälschbar sind.

create index reports_status_idx on reports (status, created_at desc);

-- ── report_content(): pinnt Melder + Snapshot serverseitig ──────────────────
create or replace function report_content(
  p_reported_user_id uuid,
  p_reported_post_id uuid,   -- nullable (Report auf User ohne konkreten Moment)
  p_reason           text,
  p_note             text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media_path text;
  v_handle     text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_reason not in ('inappropriate','harassment','spam','other') then
    raise exception 'invalid reason';
  end if;

  select media_path into v_media_path from posts    where id = p_reported_post_id;
  select handle     into v_handle     from profiles where id = p_reported_user_id;

  insert into reports (
    reporter_id, reported_user_id, reported_post_id, reason, note,
    reported_media_path, reported_handle
  )
  values (
    auth.uid(), p_reported_user_id, p_reported_post_id, p_reason, nullif(p_note, ''),
    v_media_path, v_handle
  );
end;
$$;

revoke all on function report_content(uuid, uuid, text, text) from public;
revoke all on function report_content(uuid, uuid, text, text) from anon;
grant execute on function report_content(uuid, uuid, text, text) to authenticated;

-- ── block_user(): atomar Block setzen + Follows in BEIDEN Richtungen lösen ───
create or replace function block_user(p_target uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_target = auth.uid() then
    raise exception 'cannot block yourself';
  end if;

  insert into blocks (blocker_id, blocked_id)
  values (auth.uid(), p_target)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Gegenseitige Follows in beiden Richtungen entfernen
  -- (RLS würde die Gegenrichtung sperren → hier via DEFINER).
  delete from follows
   where (follower_id = auth.uid() and followee_id = p_target)
      or (follower_id = p_target   and followee_id = auth.uid());
end;
$$;

revoke all on function block_user(uuid) from public;
revoke all on function block_user(uuid) from anon;
grant execute on function block_user(uuid) to authenticated;

-- ── unblock_user() ──────────────────────────────────────────────────────────
create or replace function unblock_user(p_target uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_target;
end;
$$;

revoke all on function unblock_user(uuid) from public;
revoke all on function unblock_user(uuid) from anon;
grant execute on function unblock_user(uuid) to authenticated;

-- ── Bidirektionaler Block-Filter auf posts (additiv) ────────────────────────
-- Erweitert posts_read_living (0015): der Block-Filter kommt OBENDRAUF auf den
-- 24h-Verfall (`expires_at > now()`), er ersetzt ihn NICHT — sonst würden
-- abgelaufene Momente wieder sichtbar (🔒 Ephemeralität). Deckt Discovery und
-- "Ich folge" ab (beide lesen direkt posts); die Stadt-Story liest über
-- city_story() (DEFINER) und ist bewusst nicht block-gefiltert — der eingefrorene
-- Corso zeigt weiter alle gezogenen Slots.
drop policy posts_read_living on posts;
create policy posts_read_living on posts for select to authenticated
using (
  expires_at > now()
  and not exists (
    select 1 from blocks b
    where (b.blocker_id = auth.uid()      and b.blocked_id = posts.author_id)
       or (b.blocker_id = posts.author_id and b.blocked_id = auth.uid())
  )
);

-- ── Nudge-Sperre bei Block (BEFORE-INSERT-Trigger) ──────────────────────────
-- Nudge-Insert läuft client-direkt → Sperre gehört als Trigger auf die Tabelle.
create or replace function reject_nudge_if_blocked() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from blocks b
    where (b.blocker_id = new.nudger_id and b.blocked_id = new.nudged_id)
       or (b.blocker_id = new.nudged_id and b.blocked_id = new.nudger_id)
  ) then
    raise exception 'blocked';
  end if;
  return new;
end;
$$;

create trigger nudges_block_guard
  before insert on nudges
  for each row execute function reject_nudge_if_blocked();

-- ── city_story(): author_id ergänzen + Block im eingefrorenen Corso durchsetzen ──
-- Seit 0015 liest die Stadt-Story über diese DEFINER-Funktion (umgeht die posts-RLS,
-- damit gezogene Slots den 24h-Verfall überleben). Dadurch greift der posts-Block-
-- Filter hier NICHT automatisch — ein blockierter Fremder bliebe im stadtweiten
-- Rampenlicht sichtbar. Deshalb wird der Block hier explizit mitgefiltert.
-- Zusätzlich author_id zurückgeben, damit Melden/Blockieren auch aus der Story geht.
-- Return-Type ändert sich → drop + recreate (create or replace erlaubt keinen neuen
-- Rückgabetyp). Rest der Definition 1:1 aus 0015 übernommen.
drop function if exists city_story(text);
create function city_story(target_city text default null)
returns table (
  slot        smallint,
  handle      text,
  media_path  text,
  post_id     uuid,
  author_id   uuid,
  prompt_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select s.slot, pr.handle, p.media_path, p.id, p.author_id, p.prompt_date
  from city_story_slots s
  join posts p    on p.id = s.post_id
  join profiles pr on pr.id = p.author_id
  where auth.uid() is not null
    and s.story_date = corso_day(now())
    and s.city = coalesce(
      target_city,
      (select city from profiles where id = auth.uid()),
      'Düsseldorf'
    )
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid()  and b.blocked_id = p.author_id)
         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid())
    )
  order by s.slot
$$;

revoke all on function city_story(text) from public;
revoke all on function city_story(text) from anon;
grant execute on function city_story(text) to authenticated;
