-- Corso — 0032: Mehrere lebende Momente pro Person
-- Auftrag Dominik, 9. Sep 2026, als Eigner-Entscheidung freigegeben.
-- Kippt PRD §4.1 („Genau ein lebender Moment pro Person") → PRD v0.6.
--
-- WARUM
--   Der laufende Corso (0031) besetzt jeden frei werdenden Slot neu. Damit ein
--   neuer Moment den bereits laufenden Corso-Slot desselben Nutzers NICHT
--   ersetzt, müssen mehrere Momente gleichzeitig leben dürfen: der Moment im
--   Slot steht seine 24 h ab, der neue lebt daneben.
--
-- WAS BLEIBT
--   - Jeder Moment lebt weiter GENAU 24 h ab dem Upload (Trigger unverändert).
--   - Pro Nutzer steht weiterhin nur EIN Moment im Corso (Guard in 0031).
--   - Discovery und „Ich folge" zeigen weiterhin EINE Kachel pro Person (den
--     neuesten Moment) — clientseitig; die weiteren Momente sind ausschließlich
--     über die Profil-Ansicht (/p/$handle) erreichbar.
--   - 🔒 Nichts wird gelöscht. Alte Momente laufen ab, sie verschwinden nicht.

-- ===========================================================================
-- 1. Der Unique-Key, der „ein Moment pro Person pro Corso-Tag" erzwang
-- ===========================================================================
-- Er war zugleich der onConflict-Schlüssel des Upserts in src/lib/supabase/
-- upload.ts. Beide Upload-Pfade stellen mit diesem Umbau auf ein reines INSERT
-- um — ohne das hier würde der zweite Moment eines Tages den ersten
-- überschreiben statt danebenzustehen.
alter table posts drop constraint if exists posts_author_id_prompt_date_key;

-- Der Index aus 0017 (author_id, prompt_date desc) bleibt: er trägt weiterhin
-- „der neueste Moment dieser Person" und wird durch den Wegfall des Constraints
-- nicht mitgerissen.

-- ===========================================================================
-- 2. Der Trigger, der den Vorgänger sofort beendete
-- ===========================================================================
drop trigger if exists posts_single_living on posts;

comment on function expire_previous_moment() is
  'ÜBERHOLT seit 0032: mehrere lebende Momente pro Person sind erlaubt, der Trigger posts_single_living ist entfernt. Funktion bleibt für die Historie stehen und wird von nichts aufgerufen.';

-- ===========================================================================
-- 3. 🔒 Härtung: der Re-Post-Zweig wird zur Verlängerungs-Lücke
-- ===========================================================================
-- enforce_post_expiry() (0015) setzte die 24-h-Uhr NEU, sobald sich auf einer
-- bestehenden Zeile der media_path änderte. Das war korrekt, solange der
-- Re-Post ein UPSERT auf dieselbe Zeile war — der Tausch WAR der neue Moment.
--
-- Ab jetzt ist jeder Moment ein eigener INSERT. Damit wäre derselbe Zweig eine
-- offene Flanke: `posts_update_self` erlaubt dem Client, seine eigene Zeile zu
-- ändern — ein präparierter Client könnte per media_path-Update alle 24 h eine
-- frische Lebensdauer auf derselben Zeile holen (inklusive ihrer Ansichten) und
-- so den Verfall unbegrenzt hinausschieben. Das verletzt 🔒 „Verfall ist nicht
-- verlängerbar" (PRD §4.1/§7).
--
-- Neue Regel, ohne Ausnahme: bei INSERT startet die Uhr, bei UPDATE steht sie.
-- Vorziehen bleibt erlaubt (Moment vorzeitig beenden), Verlängern nie.
create or replace function enforce_post_expiry()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- created_at kommt von der DB, nicht vom Client (sonst wäre die Uhr manipulierbar).
    new.created_at := now();
    new.expires_at := new.created_at + interval '24 hours';
  else
    -- Jedes Update (Consent umschalten, Moment vorzeitig beenden): die Uhr des
    -- Moments bleibt, wie sie war. least() lässt Vorziehen zu, Verlängern nicht.
    new.created_at := old.created_at;
    new.expires_at := least(
      coalesce(new.expires_at, old.expires_at),
      old.created_at + interval '24 hours'
    );
  end if;
  return new;
end;
$$;

-- Trigger unverändert (before insert or update) — nur der Rumpf ist neu.

-- ===========================================================================
-- 4. Dev-Seed nachziehen
-- ===========================================================================
-- dev_seed_city_story() (0005 → 0025) legt je Kandidat einen Post mit
-- prompt_date = corso_day() an. Das lief bisher gegen den Unique-Key und
-- funktioniert ohne ihn unverändert weiter — geprüft, kein Eingriff nötig.
-- Vermerkt, damit die Annahme dokumentiert ist und nicht neu untersucht wird.
comment on function dev_seed_city_story(int[]) is
  'Dev-Seed. Seit 0032 ohne Unique-Key auf (author_id, prompt_date) — mehrfaches Seeden am selben Tag legt jetzt mehrere Momente je Test-Konto an, statt den vorigen zu ersetzen. Aufräumen weiterhin über dev_clear_city_story_test().';
