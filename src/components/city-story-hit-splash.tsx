import { useEffect, useState } from "react";
import { corsoDay } from "@/lib/corso-day";
import { CityBackdrop } from "@/components/city-backdrop";

const STORAGE_KEY = "corso_last_city_hit_seen"; // Value: Corso-Tag als YYYY-MM-DD
const VISIBLE_MS = 3500;
const FADE_MS = 600;

// Der Aufstieg als eigener Moment (PRD §1: „Stadt Corso = Aufstieg").
// Wurde dein Moment in den laufenden Stadt Corso gezogen, bekommt das beim ersten
// Öffnen des Rücklaufs einen Vollbild-Auftritt — einmal pro Corso-Tag.
//
// Bewusst an den Rücklauf gehängt und nicht app-weit: app-weit würde es um 21:00
// mit dem DailyPromptSplash kollidieren, und der Rücklauf ist der Ort, an dem der
// Aufstieg seine Auszahlung hat.
export function CityStoryHitSplash({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<"pending" | "visible" | "fading" | "done">("pending");

  // Entscheidung erst clientseitig (kein localStorage im CF-Worker).
  useEffect(() => {
    if (!active) return;
    const today = corsoDay();
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(STORAGE_KEY);
    } catch {
      setPhase("done");
      return;
    }
    if (seen === today) {
      setPhase("done");
    } else {
      setPhase("visible");
      try {
        localStorage.setItem(STORAGE_KEY, today);
      } catch {
        /* ignorieren */
      }
    }
  }, [active]);

  useEffect(() => {
    if (phase !== "visible") return;
    const fade = setTimeout(() => setPhase("fading"), VISIBLE_MS);
    const done = setTimeout(() => setPhase("done"), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [phase]);

  if (!active || phase === "pending" || phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center px-8 bg-neutral-950 ${
        phase === "fading" ? "pointer-events-none" : ""
      }`}
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        touchAction: "none",
      }}
      aria-hidden
    >
      <CityBackdrop extraDark />

      <div className="relative z-10 w-full max-w-[22rem] text-center">
        <span className="material-symbols-outlined text-white text-[44px] drop-shadow-[0_2px_20px_rgba(0,0,0,0.7)]">
          auto_awesome
        </span>
        <h1 className="mt-5 font-serif text-[30px] font-medium leading-[1.15] tracking-[-0.01em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          Die Stadt hat dich gesehen
        </h1>
        <p className="mt-4 text-sm leading-snug text-white/60">
          Dein Moment stand heute im Stadt Corso.
        </p>
      </div>
    </div>
  );
}
