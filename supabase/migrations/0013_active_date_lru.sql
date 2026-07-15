-- Corso — active_date ist nur noch LRU-Marker, nicht mehr Tages-Schlüssel.
-- Bezug: 0011_prompts_categories.sql.
--
-- Seit 0011 ist daily_prompt (PK corso_day) die kanonische Wahrheit für
-- „welcher Prompt lief an welchem Tag" — genau ein Prompt pro Tag.
-- prompts.active_date dient nur noch als „zuletzt benutzt" für die LRU-Sortierung
-- der Auswahl und DARF sich wiederholen. Die alte Unique-Regel
-- (prompts_active_date_key, geerbt vom Ur-Schema prompt_date UNIQUE) verhindert
-- das fälschlich und lässt get_today_prompt() bei Kollision abbrechen → weg damit.

alter table prompts drop constraint if exists prompts_active_date_key;

-- Alt-Prompts (deaktiviert) tragen noch Alt-Daten → für saubere LRU-Basis leeren.
update prompts set active_date = null where not active;
