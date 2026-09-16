import { useEffect, useState } from "react";

/**
 * „Scrollt der Nutzer gerade?" — eine Quelle für die ganze App.
 *
 * Warum ein eigenes Modul und kein `onScroll` an der Nav: Gescrollt wird in
 * vielen Containern (die vier Feeds, Circle-Chat, Einstellungen, „Du",
 * Rechtstexte, die Partner-Leiste im Circle). Ein einziger Capture-Listener am
 * Dokument (`bindNativeScroll`) hört sie alle, ohne dass die Screens davon
 * wissen müssen.
 *
 * Seit dem 16. Sep 2026 scrollen auch die Feeds nativ (CSS Scroll Snap,
 * docs/SCROLL_NATIV_UMBAU.md) und feuern echte `scroll`-Events. Vorher bewegte
 * `use-snap-scroll` die Kacheln per `transform` und musste sich selbst über
 * `pingScrollActivity()` melden. Der Export bleibt für Bewegungen, die ohne
 * Scroll-Event auskommen — heute ruft ihn außer dem Listener niemand.
 *
 * Das Modul hält den Zustand außerhalb von React und meldet nur die FLANKEN
 * (ruhig ⇄ scrollend) an die Abonnenten. `scroll` feuert in jedem Frame —
 * daraus pro Frame ein `setState` zu machen, würde genau die Bewegung
 * ausbremsen, die hier flüssig aussehen soll.
 */

// Nach so langer Ruhe gilt das Scrollen als beendet. Kurz genug, dass die Nav
// direkt nach dem Absetzen des Fingers zurückwächst; lang genug, dass sie
// zwischen zwei Wischern nicht nervös auf- und zuklappt.
const IDLE_MS = 160;
// Der Ruhe-Timer wird höchstens so oft neu gestellt. Ohne die Bremse setzt ein
// 60-fps-Feed 60 Timer pro Sekunde; die Ruhe-Erkennung wird dadurch nur um
// diese Spanne ungenauer, was niemand sieht.
const REARM_THROTTLE_MS = 50;

type Listener = (scrolling: boolean) => void;

const listeners = new Set<Listener>();
let scrolling = false;
let lastPingAt = 0;
let armedAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let nativeBound = false;

function emit(next: boolean) {
  if (scrolling === next) return;
  scrolling = next;
  for (const listener of listeners) listener(next);
}

function settle() {
  timer = null;
  const rest = IDLE_MS - (performance.now() - lastPingAt);
  if (rest > 0) {
    // Während der Timer lief, kam ein weiterer Ping — Restzeit nachlegen.
    armedAt = performance.now();
    timer = setTimeout(settle, rest);
    return;
  }
  emit(false);
}

/** „Hier bewegt sich gerade etwas." Billig genug für jeden Animationsframe. */
export function pingScrollActivity() {
  const now = performance.now();
  lastPingAt = now;
  emit(true);
  if (timer === null || now - armedAt > REARM_THROTTLE_MS) {
    if (timer) clearTimeout(timer);
    armedAt = now;
    timer = setTimeout(settle, IDLE_MS);
  }
}

/**
 * Ein einziger Listener für alle nativen Scroll-Container der App.
 *
 * `scroll` steigt nicht auf, deshalb `capture: true` am Dokument — so erwischt
 * der Listener jeden Container, ohne dass die einzelnen Screens etwas davon
 * wissen müssen. Bewusst nie abgemeldet: er lebt so lange wie die App, und ein
 * passiver Listener kostet nichts.
 */
function bindNativeScroll() {
  if (nativeBound || typeof document === "undefined") return;
  nativeBound = true;
  document.addEventListener("scroll", pingScrollActivity, { capture: true, passive: true });
}

/** `true`, solange irgendwo in der App gescrollt wird. */
export function useIsScrolling() {
  const [value, setValue] = useState(false);

  useEffect(() => {
    // Erst hier, nicht beim Import: Der Cloudflare-Worker hat kein `document`.
    bindNativeScroll();
    listeners.add(setValue);
    // Zwischen Mount und Abo kann sich der Zustand geändert haben.
    setValue(scrolling);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
