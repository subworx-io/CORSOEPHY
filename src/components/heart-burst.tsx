import { useCallback, useRef, useState } from "react";

/**
 * Geteilte Folge-Bestätigung: das große, einmal aufplatzende Herz.
 * Identisch über alle Feeds (Discovery, Story …) — Animation `animate-heart-burst` in styles.css.
 */
export function HeartBurst({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <span
        className="material-symbols-outlined animate-heart-burst text-white"
        style={{ fontSize: "100px", fontVariationSettings: "'FILL' 1" }}
      >
        favorite
      </span>
    </div>
  );
}

/**
 * State-Hook für den Burst: merkt sich das aktuell platzende Handle und
 * räumt nach der Animation (700ms) selbst auf. Mehrfach-Trigger reset den Timer.
 */
export function useHeartBurst() {
  const [burstHandle, setBurstHandle] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerBurst = useCallback((handle: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setBurstHandle(handle);
    timerRef.current = setTimeout(() => setBurstHandle(null), 700);
  }, []);

  return { burstHandle, triggerBurst };
}
