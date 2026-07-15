-- Corso — Einstellungen: Anzeigename + Push-Präferenz am Profil.
-- Bezug: schmaler Settings-Screen (Benachrichtigungen + Account).
--
-- display_name: einziges frei editierbares Textfeld der App. Optional (NULL =
--   nie gesetzt). Identität bleibt der @handle; der Anzeigename ist Beiwerk.
-- push_enabled: reine Präferenz. Push-Logik ist noch nicht gebaut — hier wird
--   nur die Wahl des Nutzers persistiert, damit die spätere Logik andocken kann.
--
-- Keine neue RLS-Policy nötig: profiles_update_self (0001_init.sql) erlaubt
-- bereits, dass jeder ausschließlich seine eigene Zeile ändert (id = auth.uid()).

alter table profiles
  add column if not exists display_name text
    check (display_name is null or char_length(display_name) between 1 and 40),
  add column if not exists push_enabled boolean not null default false;
