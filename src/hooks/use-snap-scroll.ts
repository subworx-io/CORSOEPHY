import { useCallback, useEffect, useRef, useState } from "react";

export const SNAP_MS = 380;

function fireHaptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(4);
  }
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Physik-basiertes Snap-Scroll: Bild folgt direkt dem Finger,
 * nach dem Loslassen schnappt es mit RAF + easeOutCubic ein.
 */
export function useSnapScroll({
  count,
  axis = "y",
}: {
  count: number;
  axis?: "x" | "y";
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const indexRef = useRef(0);
  // Weltposition in Pixeln: indexRef.current * Bildschirmhöhe/-breite
  const posRef = useRef(0);
  const slidesRef = useRef<(HTMLElement | null)[]>([]);
  const rafRef = useRef(0);
  // Stabile Callback-Refs pro Slide-Index — verhindert React-Re-Registration bei Re-Render
  const callbacksRef = useRef<((el: HTMLElement | null) => void)[]>([]);
  // Der Feed-Container. Die Gesten-Listener hängen aus Robustheitsgründen weiter am
  // window (der Container kann später mounten), werden aber darauf eingegrenzt, ob
  // die Geste IM Container beginnt. Ohne das steuert jeder Wisch irgendwo auf der
  // Seite den Feed — auch einer auf einem Overlay darüber (Tages-Prompt-Splash).
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Geste zählt nur, wenn sie im Feed beginnt. Kein Container gesetzt → wie bisher.
  const isInsideContainer = useCallback((target: EventTarget | null) => {
    const el = containerRef.current;
    if (!el) return true;
    return target instanceof Node && el.contains(target);
  }, []);

  // Maß aus dem Container, nicht aus window.innerHeight: der Container ist `h-dvh`
  // und folgt damit der ein-/ausfahrenden Browser-Leiste auf dem Handy. innerHeight
  // driftet dagegen auseinander → Slides säßen um die Leistenhöhe versetzt.
  const getDim = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      const measured = axis === "y" ? el.clientHeight : el.clientWidth;
      if (measured > 0) return measured;
    }
    return axis === "y" ? window.innerHeight : window.innerWidth;
  }, [axis]);

  const applyPos = useCallback(
    (pos: number) => {
      const dim = getDim();
      const tr = axis === "y" ? "Y" : "X";
      slidesRef.current.forEach((el, i) => {
        if (!el) return;
        const offset = i * dim - pos;
        el.style.transform = `translate${tr}(${offset}px)`;
        // Weit entfernte Slides ausblenden
        el.style.opacity = Math.abs(offset) > dim * 1.5 ? "0" : "1";
      });
    },
    [axis, getDim]
  );

  // Aktiven Index übernehmen. Bewusst SOFORT und nicht erst am Ende der
  // Snap-Animation: `currentIndex` steuert, welches Video spielt (isActive).
  // Wurde er erst am Animationsende gesetzt, lief während des ganzen Wischens
  // noch der alte Moment weiter, während der neue eingefroren stehenblieb.
  const commitIndex = useCallback((idx: number) => {
    if (indexRef.current === idx) return;
    indexRef.current = idx;
    fireHaptic();
    setCurrentIndex(idx);
  }, []);

  const clampIndex = useCallback(
    (idx: number) => Math.max(0, Math.min(count - 1, idx)),
    [count]
  );

  // Animation zum nächsten Einrastpunkt mit easeOutCubic
  const snapTo = useCallback(
    (rawIdx: number) => {
      const targetIdx = clampIndex(rawIdx);
      const dim = getDim();
      const startPos = posRef.current;
      const targetPos = targetIdx * dim;
      const startTime = performance.now();

      cancelAnimationFrame(rafRef.current);
      // Ziel sofort aktiv schalten — das Video des Ziel-Slides startet mit der
      // Bewegung, nicht erst 380 ms später.
      commitIndex(targetIdx);

      const animate = (now: number) => {
        const t = Math.min((now - startTime) / SNAP_MS, 1);
        posRef.current = startPos + (targetPos - startPos) * easeOutCubic(t);
        applyPos(posRef.current);

        if (t < 1) {
          rafRef.current = requestAnimationFrame(animate);
        } else {
          posRef.current = targetPos;
          applyPos(targetPos);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    },
    [clampIndex, getDim, applyPos, commitIndex]
  );

  // Initiale Positionen setzen wenn count sich ändert (z.B. neue Slides in Connections)
  useEffect(() => {
    posRef.current = indexRef.current * getDim();
    applyPos(posRef.current);
  }, [count, getDim, applyPos]);

  // Größenänderung: Orientierung, aber vor allem die ein-/ausfahrende Browser-Leiste
  // auf dem Handy. Der ResizeObserver am Container erwischt das zuverlässiger als
  // `resize` am window, weil `h-dvh` sich ändert, ohne dass window feuern muss.
  useEffect(() => {
    const onResize = () => {
      posRef.current = indexRef.current * getDim();
      applyPos(posRef.current);
    };
    window.addEventListener("resize", onResize);

    const el = containerRef.current;
    const observer =
      el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    observer?.observe(el!);

    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [getDim, applyPos]);

  // Touch: Finger folgt direkt, Velocity-Projektion beim Loslassen
  useEffect(() => {
    let startTouchPos = 0;
    let startWorldPos = 0;
    let history: { pos: number; t: number }[] = [];
    let gestureActive = false;

    const getPos = (e: TouchEvent) =>
      axis === "y" ? e.touches[0].clientY : e.touches[0].clientX;
    const getEndPos = (e: TouchEvent) =>
      axis === "y" ? e.changedTouches[0].clientY : e.changedTouches[0].clientX;

    const onStart = (e: TouchEvent) => {
      // Nur Gesten, die im Feed beginnen. Ein Wisch auf einem Overlay darüber
      // (z.B. dem Tages-Prompt-Splash) darf den Feed nicht fernsteuern.
      if (!isInsideContainer(e.target)) {
        gestureActive = false;
        return;
      }
      cancelAnimationFrame(rafRef.current);
      gestureActive = true;
      startTouchPos = getPos(e);
      startWorldPos = posRef.current;
      const now = performance.now();
      history = [{ pos: startTouchPos, t: now }];
    };

    const onMove = (e: TouchEvent) => {
      if (!gestureActive) return;
      e.preventDefault();
      const now = performance.now();
      const cur = getPos(e);
      history.push({ pos: cur, t: now });
      // Nur letzten 100ms behalten
      const cutoff = now - 100;
      while (history.length > 1 && history[0].t < cutoff) history.shift();
      // Bild folgt Finger in Echtzeit
      posRef.current = startWorldPos + (startTouchPos - cur);
      applyPos(posRef.current);
      // Aktiven Slide schon beim Überqueren der Hälfte wechseln — der Moment,
      // auf den man zieht, spielt dann bereits, statt eingefroren zu warten.
      commitIndex(clampIndex(Math.round(posRef.current / getDim())));
    };

    const onEnd = (e: TouchEvent) => {
      if (!gestureActive) return;
      gestureActive = false;

      // Velocity aus Zeitfenster berechnen
      let velocityPxMs = 0;
      if (history.length >= 2) {
        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = newest.t - oldest.t;
        if (dt > 0) velocityPxMs = (oldest.pos - newest.pos) / dt;
      }

      const dim = getDim();
      // 150ms Momentum-Projektion → bestimmt den Ziel-Index
      const projectedPos = posRef.current + velocityPxMs * 150;
      const targetIdx = Math.round(projectedPos / dim);
      snapTo(targetIdx);
    };

    const onCancel = () => {
      if (!gestureActive) return;
      gestureActive = false;
      snapTo(indexRef.current);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [axis, getDim, applyPos, snapTo, isInsideContainer, commitIndex, clampIndex]);

  // Trackpad / Mausrad
  useEffect(() => {
    let snapId: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      if (!isInsideContainer(e.target)) return;
      e.preventDefault();
      cancelAnimationFrame(rafRef.current);
      const delta = axis === "x" ? e.deltaX || e.deltaY : e.deltaY;
      posRef.current += delta;
      applyPos(posRef.current);
      if (snapId) clearTimeout(snapId);
      snapId = setTimeout(() => {
        const dim = getDim();
        snapTo(Math.round(posRef.current / dim));
        snapId = null;
      }, 150);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (snapId) clearTimeout(snapId);
    };
  }, [axis, getDim, applyPos, snapTo, isInsideContainer]);

  // Maus-Drag horizontal für Stadt Corso auf Desktop
  useEffect(() => {
    if (axis !== "x") return;
    let startX = 0;
    let startWorldPos = 0;
    let tracking = false;
    let lastTouchEnd = 0;

    const onTouchEnd = () => {
      lastTouchEnd = Date.now();
    };
    const onDown = (e: MouseEvent) => {
      if (Date.now() - lastTouchEnd < 600) return;
      if (!isInsideContainer(e.target)) return;
      cancelAnimationFrame(rafRef.current);
      startX = e.clientX;
      startWorldPos = posRef.current;
      tracking = true;
    };
    const onMove = (e: MouseEvent) => {
      if (!tracking) return;
      posRef.current = startWorldPos + (startX - e.clientX);
      applyPos(posRef.current);
    };
    const onUp = () => {
      if (!tracking) return;
      tracking = false;
      if (Date.now() - lastTouchEnd < 600) {
        snapTo(indexRef.current);
        return;
      }
      snapTo(Math.round(posRef.current / getDim()));
    };

    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, getDim, applyPos, snapTo, isInsideContainer]);

  // Stabile Callback-Ref-Factory — React ruft den Callback nicht erneut auf bei Re-Render
  const slideRef = useCallback(
    (i: number) => {
      if (!callbacksRef.current[i]) {
        callbacksRef.current[i] = (el: HTMLElement | null) => {
          slidesRef.current[i] = el;
          if (el) {
            const dim = getDim();
            const offset = i * dim - posRef.current;
            const tr = axis === "y" ? "Y" : "X";
            el.style.transform = `translate${tr}(${offset}px)`;
            el.style.willChange = "transform, opacity";
          }
        };
      }
      return callbacksRef.current[i];
    },
    [axis, getDim]
  );

  return { currentIndex, slideRef, containerRef };
}
