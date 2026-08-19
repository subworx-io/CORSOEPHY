// Corso-Zeitlogik clientseitig — Gegenstück zu corso_day() in der DB.
//
// Der Corso-Zyklus läuft 21:00 → 21:00 (Europe/Berlin): um 21:00 wird die
// Stadt Corso gezogen UND der neue Prompt startet. Der Zyklus trägt weiterhin
// Prompt-Historie, story_date, Anstups-Limit und Snapshot-Basis.
//
// NICHT verwechseln mit dem Verfall: Momente und Follows leben 24h ab ihrem
// eigenen Zeitstempel (expires_at), völlig unabhängig vom Zyklus-Wechsel.

export const CYCLE_HOUR = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Datum des laufenden Zyklus als YYYY-MM-DD — spiegelt corso_day() der DB. */
export function corsoDay(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - CYCLE_HOUR * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted); // en-CA → YYYY-MM-DD
}

/** Wanduhrzeit in Berlin, unabhängig von der Zeitzone des Geräts. */
function berlinClock(d: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const [h, m, s] = parts.split(":").map(Number);
  return { h: h % 24, m, s };
}

/**
 * Beginn des laufenden Zyklus (letzte 21:00 Berlin) als ms-Zeitstempel.
 * Bewusst über die Berliner Wanduhr gerechnet, nicht über die Gerätezeit — sonst
 * sähe ein Handy in einer anderen Zeitzone einen anderen Zyklus als der Server.
 */
export function cycleStart(now: Date = new Date()): number {
  const { h, m, s } = berlinClock(now);
  const hoursSince = (h - CYCLE_HOUR + 24) % 24;
  const elapsed = ((hoursSince * 60 + m) * 60 + s) * 1000 + now.getMilliseconds();
  return now.getTime() - elapsed;
}

/**
 * Nächster Zyklus-Wechsel (nächste 21:00 Berlin) — Ziel des Story-Countdowns.
 * An den beiden Zeitumstellungstagen im Jahr ist das um eine Stunde daneben;
 * für einen Countdown ist das vertretbar.
 */
export function nextCycleStart(now: Date = new Date()): number {
  return cycleStart(now) + DAY_MS;
}
