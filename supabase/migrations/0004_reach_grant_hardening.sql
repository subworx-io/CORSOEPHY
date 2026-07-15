-- Corso — 0004: Härtung der privaten Reichweiten-Zahl (my_reach)
-- Bezug: PRD 🔒 "Follower-Zahlen sind für andere unsichtbar"; docs/STATUS.md.
--
-- Befund (15. Juli, Live-Probe mit anon-Key gegen die Produktions-DB):
--   my_reach() war für die anon-Rolle (unauthentifiziert) ausführbar und lieferte 0.
--   Kein Datenleck (auth.uid() ist NULL für anon -> count 0), aber der Grant war
--   loser als 0001_init.sql vorsah ("grant execute to authenticated"). Wir zurren
--   ihn fest: nur authenticated darf zählen, und die Funktion gibt bei fehlender
--   Identität explizit 0 zurück, statt sich auf "NULL matcht nichts" zu verlassen.
--
--   BEWUSST NICHT geändert: follows_update_own. Die clientseitige Regel "erst ab
--   dem nächsten 08:00-Reset erneuern" ist absichtlich kein DB-Constraint — der
--   legitime renew()-Pfad setzt expires_at zurück auf NULL, also DERSELBE UPDATE.
--   Ein Härten hier würde renew() brechen und ist keine Privatsphäre-Frage
--   (betrifft nur den eigenen Follow, nie eine fremde Zahl).

-- Defense-in-depth: explizite Identitäts-Prüfung, damit die 0 nicht nur ein
-- Nebeneffekt von "NULL = kein Match" ist.
create or replace function my_reach()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select case
    when auth.uid() is null then 0
    else (
      select count(*)::int
      from follows
      where followee_id = auth.uid()
        and expires_at is null
    )
  end
$$;

-- Grant festzurren: weder PUBLIC noch anon dürfen die Funktion ausführen.
revoke all on function my_reach() from public;
revoke all on function my_reach() from anon;
grant execute on function my_reach() to authenticated;
