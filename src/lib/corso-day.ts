// Corso-Tag clientseitig — spiegelt corso_day() der DB: der Tag läuft 08:00→08:00
// (Europe/Berlin). Wird für den Tages-Splash-Key genutzt, damit der Splash zum
// selben Zeitpunkt wie alles andere (Discovery/Story/Follow-Verfall) umschlägt.
export function corsoDay(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 8 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted); // en-CA → YYYY-MM-DD
}
