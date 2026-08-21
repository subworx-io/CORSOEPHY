import { useEffect, useRef, useState, type RefObject } from "react";

// Zwei-Finger-Pinch auf einem Element → Zoomfaktor, multiplikativ ab dem
// Zoom-Stand beim Gestenstart (wie in nativen Kamera-Apps). Ein-Finger-Gesten
// (Taps auf Buttons im selben Element) bleiben unberührt.
export function usePinchZoom({
  targetRef,
  enabled,
  zoom,
  onZoom,
}: {
  targetRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** aktueller Zoomfaktor — Baseline beim Start der Geste */
  zoom: number;
  onZoom: (value: number) => void;
}): boolean {
  const [pinching, setPinching] = useState(false);
  // Aktuellen Zoom in einem Ref spiegeln, damit die Listener nicht bei jeder
  // Zoom-Änderung neu gebunden werden.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !enabled) return;

    let start: { dist: number; zoom: number } | null = null;
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault(); // Browser-Seitenzoom unterbinden
      start = { dist: distance(e.touches), zoom: zoomRef.current };
      setPinching(true);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      onZoom(start.zoom * (distance(e.touches) / start.dist));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) return;
      start = null;
      setPinching(false);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      setPinching(false);
    };
  }, [targetRef, enabled, onZoom]);

  return pinching;
}
