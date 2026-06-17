import { useCallback, useEffect, useRef, useState } from "react";

export const SNAP_MS = 360;

// Momentum erst bei echtem schnellen Flick — verhindert Doppel-Advance bei normalem Swipe
const MOMENTUM_THRESHOLD_PX_MS = 1.2;

function fireHaptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(4);
  }
}

/**
 * Snap-scroll mit Velocity-Tracking und Glücksrad-Momentum.
 * axis "y" = Discovery & Connections (vertikal)
 * axis "x" = Stadt-Story (horizontal)
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
  const lockedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const advance = useCallback(
    (dir: 1 | -1) => {
      if (lockedRef.current) return;
      const next = indexRef.current + dir;
      if (next < 0 || next >= count) return;
      indexRef.current = next;
      setCurrentIndex(next);
      fireHaptic();
      lockedRef.current = true;
      setTimeout(() => {
        lockedRef.current = false;
      }, SNAP_MS);
    },
    [count]
  );

  const scheduleMomentum = useCallback(
    (dir: 1 | -1, speedPxMs: number) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      // Extra-Schritte nur bei schnellem Flick, max 3
      const steps = Math.min(Math.floor((speedPxMs - MOMENTUM_THRESHOLD_PX_MS) / 0.7), 3);
      if (steps <= 0) return;
      let delay = SNAP_MS + 40;
      for (let i = 0; i < steps; i++) {
        const t = setTimeout(() => advance(dir), delay);
        timers.current.push(t);
        delay = Math.round(delay * 1.8);
      }
    },
    [advance]
  );

  useEffect(() => {
    let startPos = 0;
    let startTime = 0;
    // gestureActive verhindert iOS-Bug: touchend feuert auf window manchmal zweimal
    let gestureActive = false;
    // Ringpuffer letzter 80ms für stabiles Velocity-Measurement
    let history: { pos: number; t: number }[] = [];

    const getPos = (e: TouchEvent) =>
      axis === "y" ? e.touches[0].clientY : e.touches[0].clientX;
    const getEndPos = (e: TouchEvent) =>
      axis === "y" ? e.changedTouches[0].clientY : e.changedTouches[0].clientX;

    const onStart = (e: TouchEvent) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      gestureActive = true;
      startPos = getPos(e);
      startTime = performance.now();
      history = [{ pos: startPos, t: startTime }];
    };

    const onMove = (e: TouchEvent) => {
      if (!gestureActive) return;
      // preventDefault blockiert iOS-Rubber-Band und Safari-eigene Scroll-Interferenz
      e.preventDefault();
      const now = performance.now();
      const cur = getPos(e);
      history.push({ pos: cur, t: now });
      // Nur letzten 80ms behalten
      const cutoff = now - 80;
      history = history.filter((h) => h.t >= cutoff);
    };

    const onEnd = (e: TouchEvent) => {
      // Guard: auf iOS feuert touchend auf window manchmal doppelt
      if (!gestureActive) return;
      gestureActive = false;

      const diff = startPos - getEndPos(e);
      if (Math.abs(diff) < 50) return;
      const dir = diff > 0 ? 1 : -1;
      advance(dir);

      // Velocity aus Zeitfenster (primär) — stabiler als Momentanwert
      let speedPxMs = 0;
      if (history.length >= 2) {
        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = newest.t - oldest.t;
        if (dt > 0) speedPxMs = Math.abs(oldest.pos - newest.pos) / dt;
      }
      // Fallback: Gesamtstrecke / Gesamtzeit — fängt schnelle Flicks mit wenig touchmove-Events
      const totalTime = performance.now() - startTime;
      if (totalTime > 0) {
        const totalSpeed = Math.abs(diff) / totalTime;
        speedPxMs = Math.max(speedPxMs, totalSpeed);
      }

      if (speedPxMs >= MOMENTUM_THRESHOLD_PX_MS) scheduleMomentum(dir, speedPxMs);
    };

    const onCancel = () => {
      gestureActive = false;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    // non-passive: damit e.preventDefault() in onMove wirkt
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [axis, advance, scheduleMomentum]);

  // Trackpad / Mausrad (Desktop)
  useEffect(() => {
    let accumulated = 0;
    let resetId: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (lockedRef.current) {
        accumulated = 0;
        return;
      }
      const delta = axis === "x" ? e.deltaX || e.deltaY : e.deltaY;
      accumulated += delta;
      if (resetId) clearTimeout(resetId);
      resetId = setTimeout(() => {
        accumulated = 0;
      }, 150);
      if (accumulated > 80) {
        advance(1);
        accumulated = 0;
      } else if (accumulated < -80) {
        advance(-1);
        accumulated = 0;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (resetId) clearTimeout(resetId);
    };
  }, [axis, advance]);

  // Maus-Drag nur horizontal für Stadt-Story auf Desktop
  // Schutz vor iOS synthetischen Mouse-Events nach touchend
  useEffect(() => {
    if (axis !== "x") return;
    let startX = 0;
    let tracking = false;
    let lastTouchEnd = 0;

    const onTouchEndGuard = () => {
      lastTouchEnd = Date.now();
    };

    const onDown = (e: MouseEvent) => {
      // iOS feuert nach touchend synthetische mousedown/mouseup — ignorieren
      if (Date.now() - lastTouchEnd < 600) return;
      startX = e.clientX;
      tracking = true;
    };
    const onUp = (e: MouseEvent) => {
      if (!tracking) return;
      if (Date.now() - lastTouchEnd < 600) { tracking = false; return; }
      tracking = false;
      const diff = startX - e.clientX;
      if (diff > 60) advance(1);
      else if (diff < -60) advance(-1);
    };

    window.addEventListener("touchend", onTouchEndGuard);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("touchend", onTouchEndGuard);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, advance]);

  return { currentIndex };
}
