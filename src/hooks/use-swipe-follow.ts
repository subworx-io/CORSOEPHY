import { useCallback, useMemo, useRef } from "react";
import type { SwipeXHandlers } from "@/hooks/use-snap-scroll";
import { haptic } from "@/lib/haptics";

// Swipe-Follow (Entscheidung Dominik, 2. Sep 2026): JEDES Folgen — auch das
// Erneuern — passiert per Rechts-Wisch auf der Kachel, Entfolgen per
// Links-Wisch; es gibt keinen Folgen-Button mehr. Die Kachel folgt dem Finger,
// ab COMMIT_FRACTION der Kachelbreite (oder einem schnellen Flick) wird
// committet, sonst federt sie zurück. Richtungen ohne Aktion: Gummiband.
//
// Der Hook übersetzt die rohen onSwipeX-Gesten aus use-snap-scroll in
// Kachel-Bewegung + Commit-Entscheid. Die Feeds registrieren pro Slide das
// Karten-Element (cardRef) und liefern pro Richtung eine Aktion.

// Ab diesem Anteil der Kachelbreite gilt der Wisch als Commit …
const COMMIT_FRACTION = 0.3;
// … oder ab dieser Geschwindigkeit in Wischrichtung (px/ms), auch bei kurzem Weg.
const COMMIT_VELOCITY = 0.6;
// Widerstand für Wischrichtungen ohne Aktion.
const RESIST = 0.18;
const SPRING_MS = 320;
// Dauer des Rausfliegens (exitOnCommit) — Feeds takten ihre Choreografie daran.
export const SWIPE_EXIT_MS = 380;

export interface SwipeAction {
  /** Darf dieser Slide in diese Richtung committen? */
  canCommit: (index: number) => boolean;
  /** Wisch war ein Commit — DB-Write + Feedback macht der Aufrufer. */
  onCommit: (index: number) => void;
  /**
   * true: Karte fliegt in Wischrichtung raus, der Aufrufer entfernt sie danach
   * aus dem Feed. false/undefined: Karte bleibt und federt zurück.
   */
  exitOnCommit?: boolean;
}

export function useSwipeFollow({ right, left }: { right?: SwipeAction; left?: SwipeAction }) {
  const cardsRef = useRef(new Map<number, HTMLElement | null>());
  // Merkt pro Kachel, ob der Finger die Commit-Schwelle schon überschritten
  // hat — daran hängt der Schwellen-Tick (einmal beim Überqueren, nicht bei
  // jedem Frame darüber).
  const crossedRef = useRef(new Map<number, boolean>());
  const callbacksRef = useRef<((el: HTMLElement | null) => void)[]>([]);

  // Stabile Ref-Factory pro Index (Muster: slideRef in use-snap-scroll).
  const cardRef = useCallback((i: number) => {
    if (!callbacksRef.current[i]) {
      callbacksRef.current[i] = (el: HTMLElement | null) => {
        cardsRef.current.set(i, el);
      };
    }
    return callbacksRef.current[i];
  }, []);

  // Aktuelle Aktionen in Refs — die Gesten-Handler bleiben stabil, auch wenn
  // der Aufrufer die Objekte pro Render neu erzeugt.
  const rightRef = useRef(right);
  rightRef.current = right;
  const leftRef = useRef(left);
  leftRef.current = left;

  const springBack = useCallback((el: HTMLElement) => {
    el.style.transition = `transform ${SPRING_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    el.style.transform = "";
    el.style.setProperty("--swipe-progress", "0");
    el.style.setProperty("--swipe-progress-left", "0");
    window.setTimeout(() => {
      el.style.transition = "";
    }, SPRING_MS + 50);
  }, []);

  const handlers: SwipeXHandlers = useMemo(
    () => ({
      move(index, dx) {
        const el = cardsRef.current.get(index);
        if (!el) return;
        const action = dx >= 0 ? rightRef.current : leftRef.current;
        const allowed = !!action && action.canCommit(index);
        // Mit Aktion volle Bewegung, sonst zäher Gummiband-Widerstand.
        const x = allowed ? dx : dx * RESIST;
        el.style.transition = "none";
        el.style.transform = `translateX(${x}px) rotate(${x / 40}deg)`;
        // Fortschritt Richtung Commit (0..1) — steuert die Herz-Overlays der Kachel.
        const width = el.clientWidth || window.innerWidth;
        const progress = allowed
          ? Math.max(0, Math.min(1, Math.abs(x) / (width * COMMIT_FRACTION)))
          : 0;
        el.style.setProperty("--swipe-progress", dx > 0 ? progress.toFixed(3) : "0");
        el.style.setProperty("--swipe-progress-left", dx < 0 ? progress.toFixed(3) : "0");
        // Spürbare Rastung: Der Finger merkt, dass der Wisch jetzt zählt —
        // ohne dass man dafür auf die Overlays schauen muss.
        const crossed = allowed && progress >= 1;
        if (crossed !== !!crossedRef.current.get(index)) {
          crossedRef.current.set(index, crossed);
          if (crossed) haptic("tick");
        }
      },
      end(index, dx, velocityX) {
        crossedRef.current.set(index, false);
        const el = cardsRef.current.get(index);
        if (!el) return;
        const dir = dx >= 0 ? 1 : -1;
        const action = dir === 1 ? rightRef.current : leftRef.current;
        const width = el.clientWidth || window.innerWidth;
        const commit =
          !!action &&
          action.canCommit(index) &&
          (Math.abs(dx) > width * COMMIT_FRACTION || velocityX * dir > COMMIT_VELOCITY);

        if (!commit) {
          springBack(el);
          return;
        }

        action.onCommit(index);
        if (action.exitOnCommit) {
          // Rausfliegen — das Entfernen aus dem Feed (und damit den Unmount)
          // übernimmt der Aufrufer über seine Exit-Mechanik.
          el.style.transition = `transform ${SWIPE_EXIT_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          el.style.transform = `translateX(${dir * width * 1.2}px) rotate(${dir * 12}deg)`;
          el.style.setProperty("--swipe-progress", "0");
          el.style.setProperty("--swipe-progress-left", "0");
        } else {
          springBack(el);
        }
      },
    }),
    [springBack],
  );

  return { cardRef, swipeHandlers: handlers };
}
