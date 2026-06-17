import { useCallback, useEffect, useRef, useState } from "react";

export const SNAP_MS = 360;

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
      // Anzahl Extra-Schritte nach Geschwindigkeit — max 4
      const steps = Math.min(Math.floor(speedPxMs / 0.45), 4);
      let delay = SNAP_MS + 30;
      for (let i = 0; i < steps; i++) {
        const t = setTimeout(() => advance(dir), delay);
        timers.current.push(t);
        // Jeder Schritt dauert länger → Rad bremst exponentiell ab
        delay = Math.round(delay * 1.7);
      }
    },
    [advance]
  );

  // Touch mit Velocity-Tracking auf touchmove
  useEffect(() => {
    let startPos = 0;
    let lastPos = 0;
    let lastTime = 0;
    let velPxMs = 0;

    const getPos = (e: TouchEvent) =>
      axis === "y" ? e.touches[0].clientY : e.touches[0].clientX;
    const getEndPos = (e: TouchEvent) =>
      axis === "y" ? e.changedTouches[0].clientY : e.changedTouches[0].clientX;

    const onStart = (e: TouchEvent) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      startPos = getPos(e);
      lastPos = startPos;
      lastTime = performance.now();
      velPxMs = 0;
    };
    const onMove = (e: TouchEvent) => {
      const now = performance.now();
      const cur = getPos(e);
      const dt = now - lastTime;
      if (dt > 0) velPxMs = (lastPos - cur) / dt; // positiv = vorwärts
      lastPos = cur;
      lastTime = now;
    };
    const onEnd = (e: TouchEvent) => {
      const diff = startPos - getEndPos(e);
      if (Math.abs(diff) < 50) return;
      const dir = diff > 0 ? 1 : -1;
      advance(dir);
      const speed = Math.abs(velPxMs);
      if (speed > 0.4) scheduleMomentum(dir, speed);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [axis, advance, scheduleMomentum]);

  // Trackpad / Mausrad
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

  // Maus-Drag (nur horizontal für Stadt-Story auf Desktop)
  useEffect(() => {
    if (axis !== "x") return;
    let startX = 0;
    let tracking = false;
    const onDown = (e: MouseEvent) => {
      startX = e.clientX;
      tracking = true;
    };
    const onUp = (e: MouseEvent) => {
      if (!tracking) return;
      tracking = false;
      const diff = startX - e.clientX;
      if (diff > 60) advance(1);
      else if (diff < -60) advance(-1);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, advance]);

  return { currentIndex };
}
