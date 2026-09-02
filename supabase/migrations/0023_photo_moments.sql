-- Corso — Foto-Momente (Entscheidung Dominik, 2. Sep 2026).
-- PRD sieht Momente seit jeher als „Foto oder vertikales Video" vor; media_type
-- erlaubt 'photo' seit 0001 — gebaut war bisher nur Video. Neu dazu: EIN Moment
-- kann aus MEHREREN Fotos bestehen (max. 5), die im Feed als überlappender
-- Foto-Stapel gezeigt werden.
--
-- Modell: posts.media_path bleibt der Primärpfad (erstes Foto bzw. das Video) —
-- alle bestehenden Lesepfade (Ziehung, Reports, Feeds) funktionieren unverändert.
-- media_paths trägt bei Foto-Momenten die vollständige, geordnete Liste
-- (inkl. des ersten Fotos). Bei Videos bleibt es NULL.
--
-- 🔒 Leitplanken unberührt: Aufnahme weiterhin nur über die Live-Kamera (Client-
-- Hook), Verfall/Einwilligung/RLS hängen an der posts-Zeile, nicht am Medium.

alter table posts
  add column if not exists media_paths text[]
    check (media_paths is null or array_length(media_paths, 1) between 1 and 5);

-- ---------------------------------------------------------------------------
-- city_story() um media_type + media_paths erweitern, damit der Stadt Corso
-- Foto-Momente rendern kann. Return-Type ändert sich → drop + recreate
-- (Muster wie 0017). Body 1:1 aus 0017 übernommen, nur die zwei Spalten neu.
-- ---------------------------------------------------------------------------

drop function if exists city_story(text);
create function city_story(target_city text default null)
returns table (
  slot        smallint,
  handle      text,
  media_path  text,
  media_type  text,
  media_paths text[],
  post_id     uuid,
  author_id   uuid,
  prompt_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select s.slot, pr.handle, p.media_path, p.media_type, p.media_paths,
         p.id, p.author_id, p.prompt_date
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
