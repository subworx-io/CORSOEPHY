// Welche Kacheln eines Feeds ihre Medien im DOM haben — eine Regel für alle
// vier Feeds (Discovery, „Ich folge", Corso, Circle).
//
// Bis 16. Sep 2026 hing das Fenster nur am RUHENDEN Index (±2). Beim schnellen
// Wischen setzt der Finger aber schon wieder auf, bevor der Feed steht — der
// ruhende Index blieb zurück, und nach zwei, drei Wischern lag die Zielkachel
// außerhalb des Fensters. Ihr Video wurde erst nach dem Stillstand eingebaut
// und geladen: rund eine halbe Sekunde schwarze Kachel.
//
// Jetzt:
//  - Einbauen richtet sich SOFORT nach dem aktiven Index und schaut in
//    Bewegungsrichtung voraus. Seit dem nativen Scroll kostet ein <video>-Mount
//    mitten in der Bewegung keine Scroll-Frames mehr — das Scrollen läuft im
//    Compositor (docs/SCROLL_NATIV_UMBAU.md, Fallstrick 7).
//  - Abgebaut wird erst, wenn auch das Fenster um den ruhenden Index die Kachel
//    nicht mehr enthält. Dadurch flackern Kacheln nicht auf und zu, während man
//    über sie hinwegwischt.

/** So viele Kacheln in Bewegungsrichtung bekommen ihre Medien vorab. */
const AHEAD = 3;
/** So viele Kacheln entgegen der Bewegungsrichtung bleiben stehen. */
const BEHIND = 1;
/**
 * So viele Kacheln voraus werden „vorgewärmt": Das Video wird einmal stumm
 * angespielt, damit iOS das erste Bild wirklich dekodiert. `preload="auto"`
 * allein reicht auf dem iPhone nicht — Safari lädt dort ohne Abspielen
 * praktisch nichts vor.
 */
const WARM = 2;

export interface MediaWindowSlot {
  /** Medien (<video>/<img>) überhaupt einbauen? */
  mount: boolean;
  preload: "auto" | "metadata";
  /** Video vorab einmal anspielen (siehe WARM). */
  warm: boolean;
}

/**
 * @param i          Index der Kachel
 * @param current    aktiver Index (`currentIndex` aus useSnapScroll)
 * @param settled    ruhender Index (`settledIndex`)
 * @param direction  Richtung der letzten Bewegung (`direction`)
 */
export function mediaWindow(
  i: number,
  current: number,
  settled: number,
  direction: 1 | -1,
): MediaWindowSlot {
  // Abstand in Bewegungsrichtung: positiv = voraus, negativ = hinter uns.
  const ahead = (i - current) * direction;
  const aheadOfSettled = (i - settled) * direction;
  const nearCurrent = ahead >= -BEHIND && ahead <= AHEAD;
  const nearSettled = aheadOfSettled >= -BEHIND && aheadOfSettled <= AHEAD;
  return {
    mount: nearCurrent || nearSettled,
    preload: nearCurrent ? "auto" : "metadata",
    warm: ahead >= 1 && ahead <= WARM,
  };
}
