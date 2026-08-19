import { supabase } from "@/lib/supabase/client";
import { corsoDay } from "@/lib/corso-day";

// Prompt-Historie: welcher Prompt lief an welchem Corso-Tag.
// `daily_prompt` ist die kanonische Wahrheit (eine Zeile pro Tag, siehe
// 0011_prompts_categories.sql). Bewusst KEIN Rückfall auf prompts.active_date —
// das ist seit 0013 nur noch ein LRU-Marker und würde den falschen Prompt zeigen.
// Kein Prompt gefunden (Posts von vor der daily_prompt-Einführung) → lieber
// nichts anzeigen als etwas Falsches.

type JoinedPrompt = { text?: string } | { text?: string }[] | null;

/**
 * Holt die Prompt-Texte für mehrere Corso-Tage in EINER Abfrage.
 * Ein Moment lebt 24h ab seinem Post, der Zyklus wechselt um 21:00 — ein Feed
 * enthält also fast immer zwei Prompt-Tage. Pro Kachel einzeln nachzufragen wäre
 * ein Request pro Moment.
 */
export async function fetchPromptsByDate(
  dates: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(dates.filter((d): d is string => !!d)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from("daily_prompt")
    .select("corso_day, prompts (text)")
    .in("corso_day", unique);
  if (error || !data) return {};

  const byDate: Record<string, string> = {};
  for (const row of data as { corso_day: string; prompts: JoinedPrompt }[]) {
    const prompt = Array.isArray(row.prompts) ? row.prompts[0] : row.prompts;
    if (prompt?.text) byDate[row.corso_day] = prompt.text;
  }
  return byDate;
}

/**
 * Label über dem Prompt: „Heute" / „Gestern" / „Di, 12. Aug".
 * Nötig, weil ein lebender Moment über die 21:00-Grenze hinausreichen kann — ohne
 * den Tag wechselte der Prompt beim Scrollen ohne sichtbaren Grund.
 */
export function promptDayLabel(promptDate: string): string {
  const today = corsoDay();
  if (promptDate === today) return "Heute";

  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  if (promptDate === d.toISOString().slice(0, 10)) return "Gestern";

  return new Date(`${promptDate}T12:00:00Z`).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
