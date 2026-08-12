import { useEffect, useState } from "react";
import { corsoDay } from "@/lib/corso-day";
import { useTodayPrompt } from "@/lib/prompts/use-today-prompt";
import { CityBackdrop } from "@/components/city-backdrop";

const STORAGE_KEY = "corso_last_prompt_seen"; // Value: Corso-Tag als YYYY-MM-DD
const VISIBLE_MS = 3000; // nach 3 s automatisch ausblenden
const FADE_MS = 500;

// Vollbild-Splash beim ersten App-Öffnen pro Corso-Tag: zeigt den heutigen Prompt,
// blendet nach 3 s von selbst aus. Kein Skip-Button, kein CTA (bewusst passiv).
export function DailyPromptSplash() {
  const { data: prompt } = useTodayPrompt();
  // "pending" = wir wissen noch nicht, ob heute schon gesehen (SSR-sicher: Server
  // und erster Client-Render zeigen nichts → keine Hydration-Mismatch).
  const [phase, setPhase] = useState<"pending" | "visible" | "fading" | "done">("pending");

  // Entscheidung erst clientseitig (localStorage gibt's im CF-Worker nicht).
  useEffect(() => {
    const today = corsoDay();
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage nicht verfügbar (privater Modus o.ä.) → Splash überspringen.
      setPhase("done");
      return;
    }
    if (seen === today) {
      setPhase("done"); // heute schon gesehen
    } else {
      setPhase("visible");
      try {
        localStorage.setItem(STORAGE_KEY, today);
      } catch {
        /* ignorieren */
      }
    }
  }, []);

  // Dev/Test: Vorschau erzwingen (Button im Discovery-Header). Zeigt den Splash
  // sofort, unabhängig vom „einmal pro Tag"-Merker und OHNE localStorage zu ändern.
  useEffect(() => {
    const preview = () => setPhase("visible");
    window.addEventListener("corso:preview-splash", preview);
    return () => window.removeEventListener("corso:preview-splash", preview);
  }, []);

  // Auto-Ausblenden nach 3 s.
  useEffect(() => {
    if (phase !== "visible") return;
    const fade = setTimeout(() => setPhase("fading"), VISIBLE_MS);
    const done = setTimeout(() => setPhase("done"), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [phase]);

  if (phase === "pending" || phase === "done") return null;
  if (!prompt?.text) return null; // kein Prompt (leere Tabelle) → kein leerer Splash

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center px-8 bg-neutral-950 ${
        phase === "fading" ? "pointer-events-none" : ""
      }`}
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        // Der Splash liegt über dem Feed. Ohne das löst ein Wisch darauf noch das
        // native Seiten-Scrollen aus (Browser-Leiste fährt ein) — der Feed darunter
        // ist davon nichts bekannt und wirkt danach verrutscht.
        touchAction: "none",
      }}
      aria-hidden
    >
      {/* Exakt der Stadt-Hintergrund aus dem Story-Empty-Look, einen Tick dunkler */}
      <CityBackdrop extraDark />

      {/* Prompt in einem dezenten Glas-Container — hebt die weiße Schrift ab */}
      <div className="relative z-10 w-full max-w-[22rem] rounded-[1.75rem] border border-white/10 bg-white/[0.06] px-7 py-8 text-center backdrop-blur-md shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-white/50">
          Prompt des Tages
        </div>
        <h1 className="mt-4 text-[26px] font-semibold leading-snug tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          {prompt.text}
        </h1>
      </div>
    </div>
  );
}
