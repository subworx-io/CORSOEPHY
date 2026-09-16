import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

// ── Nativer Snap-Feed (Umbau 16. Sep 2026, docs/SCROLL_NATIV_UMBAU.md) ───────
//
// Bis hierhin hat dieser Hook jede Berührung selbst abgefangen und die Kacheln
// per `transform` + requestAnimationFrame bewegt. Das lief komplett auf dem
// Haupt-Thread — jeder React-Render und jede Video-Dekodierung kostete Frames.
// Jetzt scrollt der Browser selbst (CSS Scroll Snap, Klassen `snap-feed` und
// `snap-feed-slide` in styles.css). Die Bewegung läuft im Compositor und
// erreicht die volle Bildrate, auch wenn JavaScript gerade beschäftigt ist.
//
// Was hier übrig bleibt:
//  - welcher Slide aktiv ist (IntersectionObserver, kein `scroll`-Rechnen),
//  - wann die Bewegung steht (`scrollend`, mit Fallback),
//  - Quer-Wisch (Swipe-Follow) und Tipp aus Pointer-Events,
//  - eine Schutzfläche, die Berührungen während des Nachlaufens abfängt,
//  - die sichtbare Kachel festhalten, wenn sich die Liste darüber ändert.
//
// Weggefallen: Feder, Gummiband, Momentum-Projektion, Wheel-Handler,
// Maus-Drag für eine x-Achse (hatte keinen Aufrufer mehr).
//
// ⚠️ Nirgends `preventDefault()` auf Touch-Events und keine nicht-passiven
// Touch-Listener. Ein einziger davon zwingt den Compositor, vor jedem Frame
// auf JavaScript zu warten — und der ganze Umbau wäre umsonst.

// Ab dieser Fingerbewegung (px) entscheidet sich die Achse einer Geste.
const AXIS_LOCK_SLOP = 10;

// So lange ohne `scroll`-Event gilt die Bewegung als beendet. Ohne `scrollend`
// (ältere Safaris) ist das DER Weg; mit `scrollend` nur ein Sicherheitsnetz,
// denn nicht jede Engine meldet ein Ende für einen harten `scrollTop`-Sprung.
// Ohne das Netz bliebe `movingRef` hängen, und Tipps kämen nicht mehr an.
// Kürzer als 120 ms ließe Momentum-Pausen als Ende durchgehen.
const supportsScrollEnd = typeof window !== "undefined" && "onscrollend" in window;
const SCROLL_IDLE_MS = supportsScrollEnd ? 250 : 120;

// Toleranz, ab der eine Scroll-Position als „auf der Kachel eingerastet" gilt.
const ALIGN_TOLERANCE_PX = 2;

// Längstens so lange blockiert die Schutzfläche (siehe unten) neue Berührungen,
// auch wenn das Ende der Bewegung nie gemeldet wird. Ein natives Einrasten
// dauert auf dem iPhone deutlich kürzer.
const SHIELD_MAX_MS = 1200;

/**
 * Quer zur Feed-Achse wischen (Swipe-Follow). Vertikal scrollt der Browser
 * (`touch-action: pan-y`); was horizontal beginnt, kommt hier an. Beginnt der
 * Browser doch zu scrollen, bricht er die Geste ab (`pointercancel`) — ein
 * Wisch ist also entweder Scrollen ODER Folgen, nie beides.
 */
export interface SwipeXHandlers {
  /** Finger bewegt sich horizontal — dx relativ zum Gestenstart (px, rechts > 0). */
  move: (index: number, dx: number) => void;
  /** Geste beendet — dx final, velocityX in px/ms (rechts > 0). */
  end: (index: number, dx: number, velocityX: number) => void;
}

/**
 * Ein Tipp auf den Feed — ohne Bewegung losgelassen.
 *
 * Kommt weiterhin aus dem Hook statt aus `onClick` am Element: So entscheidet
 * EINE Stelle, was Tipp, Quer-Wisch und Scroll ist. Ein Tipp, der eine noch
 * laufende Scroll-Bewegung anhält, zählt bewusst nicht als Tipp.
 */
export interface TapInfo {
  /** Slide, auf dem getippt wurde. */
  index: number;
  x: number;
  y: number;
  /** Rechteck des Feed-Containers — Bezug für die Tipp-Zonen (tapDirection). */
  rect: DOMRect;
  /** Getroffenes Element — für Aufrufer, die Bedienelemente aussparen wollen. */
  target: EventTarget | null;
}

export function useSnapScroll({
  count,
  onSwipeX,
  onTap,
}: {
  count: number;
  /** Horizontale Wisch-Gesten (Swipe-Follow). */
  onSwipeX?: SwipeXHandlers;
  /** Tipp ohne Bewegung. Siehe TapInfo. */
  onTap?: (info: TapInfo) => void;
}) {
  // Zwei Indizes, bewusst getrennt:
  //  - `currentIndex` wechselt SOFORT, sobald eine Kachel zur Hälfte im Bild
  //    ist. Daran hängt, welcher Moment spielt.
  //  - `settledIndex` zieht erst nach, wenn die Bewegung steht. Daran gehören
  //    die teuren Entscheidungen, etwa welche <video>-Elemente im DOM sind.
  //    Ein <video>-Mount mitten in der Geste kostet Frames.
  const [currentIndex, setCurrentIndex] = useState(0);
  const [settledIndex, setSettledIndex] = useState(0);
  // Richtung der letzten Bewegung (+1 = weiter, -1 = zurück). Das Medien-Fenster
  // der Feeds lädt in diese Richtung voraus (lib/feed-media-window.ts).
  const [direction, setDirection] = useState<1 | -1>(1);
  const indexRef = useRef(0);
  const countRef = useRef(count);
  countRef.current = count;

  // Der Container als State statt nur als Ref: Er mountet in mehreren Screens
  // erst später (Ladezustand, leer → besetzt). Die Effekte unten müssen sich
  // dann neu an den frischen Knoten hängen. Mit einem reinen Ref liefen sie nur
  // beim ersten Mount und gingen bei einem späten Container leer aus.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerElRef.current = el;
    setContainer(el);
  }, []);

  const slidesRef = useRef<(HTMLElement | null)[]>([]);
  const slideCallbacksRef = useRef<((el: HTMLElement | null) => void)[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Die Kachel, die zuletzt ruhig im Bild stand. Ändert sich die Liste darüber
  // (Kachel nach Follow entfernt, neue Momente oben einsortiert), bleibt genau
  // diese Kachel stehen — siehe Layout-Effekt unten.
  const anchorRef = useRef<HTMLElement | null>(null);
  // Finger liegt auf dem Feed / der Feed bewegt sich noch. In beiden Fällen
  // darf niemand `scrollTop` anfassen, sonst kämpft JavaScript gegen den
  // Browser.
  const touchingRef = useRef(false);
  const movingRef = useRef(false);
  // Wartet auf das Ende der aktuellen Bewegung (Choreografien nach dem Folgen).
  const settleWaitersRef = useRef<(() => void)[]>([]);
  // Ziel einer laufenden `snapTo`-Bewegung und Richtung des letzten Scrolls —
  // beides braucht die Schutzfläche, um zu wissen, auf welche Kachel der Feed
  // gerade zuläuft.
  const targetRef = useRef<number | null>(null);
  const lastTopRef = useRef(0);
  const scrollDirRef = useRef<1 | -1 | 0>(0);
  // Der nächste Scroll-Event stammt von `jumpTo` (unsichtbares Festhalten) und
  // soll die Schutzfläche nicht auslösen.
  const suppressShieldRef = useRef(false);

  // ── Schutzfläche während des Nachlaufens ──────────────────────────────────
  // Problem (Befund 16. Sep 2026, iPhone): Setzt man den Finger auf, während der
  // Feed nach einem Wisch noch einrastet, übernimmt iOS die Berührung sofort für
  // den laufenden Scroll. Unser Code bekommt nur noch `pointercancel` — ein
  // Quer-Wisch zum Folgen kommt nie an, und der vertikale Anteil der Bewegung
  // scrollt einfach weiter.
  //
  // Lösung: Solange der Feed ohne Finger nachläuft, liegt über ihm eine
  // unsichtbare Fläche (`snap-feed-shield`, `touch-action: none`). Eine
  // Berührung landet dann dort statt im Scroller. Das Einrasten darunter läuft
  // ungestört zu Ende, und die Geste gehört uns:
  //  - quer → Swipe-Follow auf der Kachel, auf die der Feed zuläuft,
  //  - senkrecht → ein Schritt weiter/zurück per `snapTo`.
  // Im Ruhezustand ist die Fläche durchlässig (`pointer-events: none`), dann
  // scrollt wieder allein der Browser.
  const [shield, setShield] = useState<HTMLDivElement | null>(null);
  const shieldElRef = useRef<HTMLDivElement | null>(null);
  const shieldRef = useCallback((el: HTMLDivElement | null) => {
    shieldElRef.current = el;
    setShield(el);
  }, []);
  const shieldOnRef = useRef(false);
  // Eine Geste auf der Fläche läuft gerade — dann bleibt sie an, auch wenn der
  // Feed darunter schon steht. Ein Abschalten mitten in der Geste könnte den
  // Pointer-Strom abreißen lassen.
  const shieldGestureRef = useRef(false);
  const shieldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zuletzt benutzte Eingabeart. Die Schutzfläche gilt nur für Touch: Am
  // Desktop würde sie das Mausrad-Scrollen blockieren (Wheel-Events auf der
  // Fläche erreichen den Scroller nicht).
  const lastPointerTypeRef = useRef<string | null>(null);

  const setShieldActive = useCallback((on: boolean) => {
    if (on && lastPointerTypeRef.current !== "touch") return;
    if (on === shieldOnRef.current) return;
    if (!on && shieldGestureRef.current) return;
    if (shieldTimerRef.current) {
      clearTimeout(shieldTimerRef.current);
      shieldTimerRef.current = null;
    }
    shieldOnRef.current = on;
    const el = shieldElRef.current;
    if (el) el.style.pointerEvents = on ? "auto" : "none";
    if (!on) return;
    // Sicherheitsnetz: Bleibt das Ende der Bewegung aus, darf die Fläche den
    // Feed nicht dauerhaft blockieren.
    shieldTimerRef.current = setTimeout(() => {
      shieldTimerRef.current = null;
      if (shieldGestureRef.current) return;
      shieldOnRef.current = false;
      if (shieldElRef.current) shieldElRef.current.style.pointerEvents = "none";
    }, SHIELD_MAX_MS);
  }, []);

  const clampIndex = useCallback(
    (idx: number) => Math.max(0, Math.min(countRef.current - 1, idx)),
    [],
  );

  // Aktiven Index übernehmen. Bewusst sofort und nicht erst am Ende der
  // Bewegung: Der Moment, auf den man zieht, spielt dann schon.
  const commitIndex = useCallback((idx: number) => {
    if (indexRef.current === idx) return;
    setDirection(idx > indexRef.current ? 1 : -1);
    indexRef.current = idx;
    haptic("tick");
    setCurrentIndex(idx);
  }, []);

  const flushSettleWaiters = useCallback(() => {
    const waiters = settleWaitersRef.current;
    if (!waiters.length) return;
    settleWaitersRef.current = [];
    for (const fn of waiters) fn();
  }, []);

  // Die Bewegung steht. Index aus der echten Position ablesen. Der Browser hat
  // eingerastet, das Ergebnis ist also ein ganzzahliges Vielfaches der Höhe.
  const settle = useCallback(() => {
    const el = containerElRef.current;
    if (!el || touchingRef.current) return;
    const h = el.clientHeight;
    if (h <= 0) return;
    const raw = el.scrollTop / h;
    const idx = clampIndex(Math.round(raw));
    movingRef.current = false;
    targetRef.current = null;
    setShieldActive(false);
    // Noch zwischen zwei Kacheln (z. B. Ruhe-Timer in einer Momentum-Pause):
    // Das ist kein Ende. Rastet der Browser nach, kommt ein neuer Scroll-Event.
    // `movingRef` wird trotzdem zurückgesetzt, sonst bliebe es hängen, falls
    // doch keiner mehr kommt.
    if (Math.abs(el.scrollTop - idx * h) > ALIGN_TOLERANCE_PX) return;
    commitIndex(idx);
    setSettledIndex(idx);
    anchorRef.current = slidesRef.current[idx] ?? null;
    flushSettleWaiters();
  }, [clampIndex, commitIndex, flushSettleWaiters, setShieldActive]);

  /**
   * Zu einer Kachel scrollen. `onSettled` läuft, sobald die Bewegung wirklich
   * steht. Die Dauer eines nativen Smooth-Scrolls hängt von Gerät und
   * Systemeinstellung ab, ein fester Timer passt deshalb nicht mehr.
   */
  const snapTo = useCallback(
    (rawIdx: number, onSettled?: () => void) => {
      const el = containerElRef.current;
      const idx = clampIndex(rawIdx);
      if (onSettled) settleWaitersRef.current.push(onSettled);
      if (!el) {
        flushSettleWaiters();
        return;
      }
      const top = idx * el.clientHeight;
      // Schon dort: Es käme kein `scrollend`, also direkt abschließen.
      if (Math.abs(el.scrollTop - top) <= ALIGN_TOLERANCE_PX) {
        requestAnimationFrame(settle);
        return;
      }
      // Ziel sofort aktiv schalten: Das Video startet mit der Bewegung.
      commitIndex(idx);
      movingRef.current = true;
      targetRef.current = idx;
      setShieldActive(true);
      el.scrollTo({ top, behavior: "smooth" });
    },
    [clampIndex, commitIndex, flushSettleWaiters, settle, setShieldActive],
  );

  // Harter Sprung ohne Animation — nur intern, für das Festhalten der Kachel.
  const jumpTo = useCallback((idx: number) => {
    const el = containerElRef.current;
    if (!el) return;
    const top = idx * el.clientHeight;
    if (Math.abs(el.scrollTop - top) > ALIGN_TOLERANCE_PX) suppressShieldRef.current = true;
    el.scrollTop = top;
    anchorRef.current = slidesRef.current[idx] ?? null;
    indexRef.current = idx;
    setCurrentIndex(idx);
    setSettledIndex(idx);
  }, []);

  // ── Aktiver Index: IntersectionObserver statt `scroll`-Rechnen ────────────
  // Der Observer meldet sich nur beim Überschreiten der Hälfte und nicht in
  // jedem Frame. Das Scrollen selbst bleibt damit frei von Arbeit auf dem
  // Haupt-Thread.
  useEffect(() => {
    if (!container || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
          const idx = slidesRef.current.indexOf(entry.target as HTMLElement);
          if (idx >= 0) commitIndex(idx);
        }
      },
      { root: container, threshold: 0.5 },
    );
    observerRef.current = observer;
    for (const slide of slidesRef.current) if (slide) observer.observe(slide);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [container, commitIndex]);

  // ── Ende der Bewegung ─────────────────────────────────────────────────────
  // Der `scroll`-Listener ist passiv und setzt nur ein Flag. Die eigentliche
  // Arbeit passiert erst am Ende. Ohne `scrollend` (ältere Safaris) übernimmt
  // ein kurzer Ruhe-Timer.
  //
  // Die BottomNav hört über `lib/scroll-activity.ts` am Dokument mit (Capture).
  // Ein nativer Scroll-Container erreicht sie ohne eigenes Zutun, deshalb gibt
  // es hier keinen `pingScrollActivity()` mehr.
  useEffect(() => {
    if (!container) return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(settle, SCROLL_IDLE_MS);
    };
    const onScroll = () => {
      movingRef.current = true;
      const top = container.scrollTop;
      if (top !== lastTopRef.current) scrollDirRef.current = top > lastTopRef.current ? 1 : -1;
      lastTopRef.current = top;
      // Nachlaufen ohne Finger (Momentum, Einrasten, snapTo) → Schutzfläche an.
      if (suppressShieldRef.current) suppressShieldRef.current = false;
      else if (!touchingRef.current) setShieldActive(true);
      armIdle();
    };
    const onTouchStart = () => {
      touchingRef.current = true;
      lastPointerTypeRef.current = "touch";
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      touchingRef.current = false;
      // Finger weg, Feed läuft noch nach → ab jetzt fängt die Schutzfläche
      // neue Berührungen ab.
      if (movingRef.current) setShieldActive(true);
      // Während der Finger lag, hat `settle` bewusst nichts getan. Wartet noch
      // etwas auf das Ende, jetzt nachholen.
      if (movingRef.current || settleWaitersRef.current.length) armIdle();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    if (supportsScrollEnd) container.addEventListener("scrollend", settle);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("scrollend", settle);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [container, settle, setShieldActive]);

  // ── Höhe ändert sich (Browser-Leiste, Drehen) ─────────────────────────────
  // Mandatory Snap rastet in der Regel selbst neu ein. Verlassen wird sich
  // darauf nicht: Im Ruhezustand wird die Position auf den Index gesetzt.
  useEffect(() => {
    if (!container || typeof ResizeObserver === "undefined") return;
    let lastHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const h = container.clientHeight;
      if (h === lastHeight) return;
      lastHeight = h;
      if (touchingRef.current || movingRef.current) return;
      container.scrollTop = indexRef.current * h;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  // ── Sichtbare Kachel festhalten (Fallstrick 4) ────────────────────────────
  // Beim nativen Scrollen verschiebt jede Änderung ÜBER der aktuellen Position
  // das Bild: Eine gefolgte Kachel verschwindet, oder ein Refetch sortiert neue
  // Momente oben ein. Der Effekt läuft nach jedem Commit und VOR dem Malen.
  // Hat sich die Kachel unter dem Index verschoben, springt die Position
  // unsichtbar mit. Der Normalfall ist ein einziger Array-Vergleich.
  //
  // Fällt die gehaltene Kachel selbst weg (letzte Kachel gefolgt, Moment
  // abgelaufen), bleibt der Index stehen und wird nur geklemmt.
  useLayoutEffect(() => {
    const el = containerElRef.current;
    if (!el || count === 0) return;
    if (touchingRef.current || movingRef.current) return;
    const slides = slidesRef.current;
    const anchor = anchorRef.current;
    const idx = indexRef.current;
    if (anchor && slides[idx] === anchor && idx < count) return;

    const found = anchor && anchor.isConnected ? slides.indexOf(anchor) : -1;
    const next = found >= 0 && found < count ? found : clampIndex(idx);
    const aligned = Math.abs(el.scrollTop - next * el.clientHeight) <= ALIGN_TOLERANCE_PX;
    if (next === idx && aligned) {
      anchorRef.current = slides[next] ?? null;
      return;
    }
    jumpTo(next);
  });

  // ── Quer-Wisch und Tipp ───────────────────────────────────────────────────
  // Pointer-Events statt Touch-Events: Beginnt der Browser vertikal zu
  // scrollen, schickt er `pointercancel`. Er erledigt den Achsen-Lock also
  // selbst. Für die Maus am Desktop gilt derselbe Pfad.
  const swipeXRef = useRef<SwipeXHandlers | undefined>(onSwipeX);
  swipeXRef.current = onSwipeX;
  const onTapRef = useRef<((info: TapInfo) => void) | undefined>(onTap);
  onTapRef.current = onTap;

  useEffect(() => {
    if (!container) return;
    let pointerId: number | null = null;
    let lock: "none" | "cross" | "dead" = "none";
    let startX = 0;
    let startY = 0;
    let swipeIndex = 0;
    // Lief beim Aufsetzen noch eine Bewegung? Dann hält der Tipp sie nur an.
    let stoppedScroll = false;
    // Begann die Geste auf der Schutzfläche statt im Scroller?
    let onShield = false;
    let history: { pos: number; t: number }[] = [];

    const velocity = () => {
      if (history.length < 2) return 0;
      const oldest = history[0];
      const newest = history[history.length - 1];
      const dt = newest.t - oldest.t;
      return dt > 0 ? (newest.pos - oldest.pos) / dt : 0;
    };

    // Die Kachel, auf die der Feed gerade zuläuft. Bei snapTo ist das Ziel
    // bekannt, sonst entscheidet die Richtung des letzten Scrolls. Mandatory
    // Snap rastet in dieser Richtung auf der nächsten Kachel ein.
    const settleTarget = () => {
      if (targetRef.current !== null) return targetRef.current;
      const h = container.clientHeight;
      if (h <= 0) return indexRef.current;
      const pos = container.scrollTop / h;
      const dir = scrollDirRef.current;
      const idx =
        dir > 0 ? Math.ceil(pos - 0.02) : dir < 0 ? Math.floor(pos + 0.02) : Math.round(pos);
      return clampIndex(idx);
    };

    const endShieldGesture = () => {
      if (!onShield) return;
      onShield = false;
      shieldGestureRef.current = false;
      if (!movingRef.current) setShieldActive(false);
    };

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointerId = e.pointerId;
      lastPointerTypeRef.current = e.pointerType;
      lock = "none";
      startX = e.clientX;
      startY = e.clientY;
      onShield = e.currentTarget !== container;
      if (onShield) {
        shieldGestureRef.current = true;
        swipeIndex = settleTarget();
        stoppedScroll = true;
      } else {
        // Der Quer-Wisch gilt für den Slide, auf dem die Geste BEGINNT.
        swipeIndex = indexRef.current;
        stoppedScroll = movingRef.current;
      }
      history = [{ pos: e.clientX, t: performance.now() }];
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (lock === "none") {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (Math.max(dx, dy) < AXIS_LOCK_SLOP) return;
        lock = dx > dy && swipeXRef.current ? "cross" : "dead";
        if (lock === "cross") {
          // Maus: Bewegungen außerhalb des Elements weiter empfangen.
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            // Pointer schon weg — die Geste endet ohnehin gleich.
          }
        } else if (onShield) {
          // Senkrecht auf der Schutzfläche: Der Browser scrollt hier nicht
          // selbst, also einen Schritt in Wischrichtung auslösen (Finger nach
          // oben = nächster Moment).
          const step = e.clientY < startY ? 1 : -1;
          snapTo(settleTarget() + step);
        }
      }
      if (lock !== "cross") return;
      const now = performance.now();
      history.push({ pos: e.clientX, t: now });
      // Nur die letzten 100 ms zählen für die Geschwindigkeit.
      while (history.length > 1 && history[0].t < now - 100) history.shift();
      swipeXRef.current?.move(swipeIndex, e.clientX - startX);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      endShieldGesture();
      if (lock === "cross") {
        swipeXRef.current?.end(swipeIndex, e.clientX - startX, velocity());
        return;
      }
      if (lock !== "none" || stoppedScroll) return;
      onTapRef.current?.({
        index: indexRef.current,
        x: e.clientX,
        y: e.clientY,
        rect: container.getBoundingClientRect(),
        target: e.target,
      });
    };

    // Browser hat übernommen (vertikaler Scroll) oder das System hat die Geste
    // abgebrochen. Eine angefangene Quer-Geste federt zurück.
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      endShieldGesture();
      if (lock === "cross") swipeXRef.current?.end(swipeIndex, 0, 0);
    };

    // Sicherheitsnetz: App geht mitten in der Quer-Geste in den Hintergrund
    // und iOS liefert weder `pointerup` noch `pointercancel`.
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      touchingRef.current = false;
      if (pointerId !== null) {
        pointerId = null;
        if (lock === "cross") swipeXRef.current?.end(swipeIndex, 0, 0);
      }
      endShieldGesture();
      setShieldActive(false);
    };

    const targets: HTMLElement[] = shield ? [container, shield] : [container];
    for (const t of targets) {
      t.addEventListener("pointerdown", onDown, { passive: true });
      t.addEventListener("pointermove", onMove, { passive: true });
      t.addEventListener("pointerup", onUp, { passive: true });
      t.addEventListener("pointercancel", onCancel, { passive: true });
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      for (const t of targets) {
        t.removeEventListener("pointerdown", onDown);
        t.removeEventListener("pointermove", onMove);
        t.removeEventListener("pointerup", onUp);
        t.removeEventListener("pointercancel", onCancel);
      }
      document.removeEventListener("visibilitychange", onHidden);
      shieldGestureRef.current = false;
    };
  }, [container, shield, clampIndex, snapTo, setShieldActive]);

  // Aufräumen beim Unmount: kein Timer darf eine verwaiste Fläche umschalten.
  useEffect(
    () => () => {
      if (shieldTimerRef.current) clearTimeout(shieldTimerRef.current);
    },
    [],
  );

  // Stabile Callback-Ref pro Slide-Index. React ruft sie bei einem Re-Render
  // nicht erneut auf.
  const slideRef = useCallback((i: number) => {
    if (!slideCallbacksRef.current[i]) {
      slideCallbacksRef.current[i] = (el: HTMLElement | null) => {
        const prev = slidesRef.current[i];
        slidesRef.current[i] = el;
        // Beim Umsortieren löst React erst die alten Refs und setzt dann die
        // neuen. Ein Knoten, der nur den Index wechselt, wird hier kurz
        // abgemeldet und gleich wieder angemeldet. Das ist harmlos.
        if (prev && prev !== el && !slidesRef.current.includes(prev)) {
          observerRef.current?.unobserve(prev);
        }
        if (el) observerRef.current?.observe(el);
      };
    }
    return slideCallbacksRef.current[i];
  }, []);

  return { currentIndex, settledIndex, direction, slideRef, containerRef, shieldRef, snapTo };
}
