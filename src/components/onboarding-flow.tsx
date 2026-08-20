import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { logEvent } from "@/lib/events";
import { CityBackdrop } from "@/components/city-backdrop";
import { OnboardingHandleStep } from "@/components/onboarding-handle-step";

// Der First-Run für neu eingeladene User. Look 1:1 vom Prompt-Splash
// (daily-prompt-splash.tsx): Vollbild-Overlay über allem, geblurrter Stadt-
// Hintergrund, ruhige weiße Schrift im Glas-Container. Kein Marketing-Ton —
// wir erklären den Kontrakt, den Corso mit dir eingeht.
//
// Ablauf: 1–3 überspringbare Erklär-Screens → (nur wenn noch kein Profil)
// Handle-Pflichtschritt → offener Erst-Moment-Nudge. Der localStorage-Merker
// wird erst beim ABSCHLUSS gesetzt (via onComplete im AuthGate), nicht beim
// Anzeigen — ein Abbruch vor dem Ende wiederholt den Flow beim Neustart.

// TODO: Text-/Design-Pass — Anzahl & Copy der Erklär-Screens sind eine offene
// Design-Frage (PRD Open Question). Diese drei Screens sind ein Entwurf: sie
// vermitteln den Kern-Kontrakt in ruhiger, ehrlicher Sprache. Reihenfolge:
// Sichtbarkeit an Lieferung gekoppelt → alles vergeht → kein Profil/keine Zahlen.
const EXPLAINER_SCREENS: { eyebrow: string; title: string; body: string }[] = [
  {
    eyebrow: "So funktioniert Corso",
    title: "Du siehst deine Stadt nur, wenn sie postet.",
    body: "Kein endloser Feed. Es gibt Momente, wenn Menschen um dich herum welche aufnehmen — und um 21 Uhr geht Düsseldorf gemeinsam spazieren.",
  },
  {
    eyebrow: "Sichtbar bleibst du,",
    title: "indem du lieferst.",
    body: "Wer dir folgt, bleibt 24 Stunden. Danach entscheidet sich neu, ob du noch da bist. Kein Vorrat, kein Nachholen — nur der nächste Moment.",
  },
  {
    eyebrow: "Alles vergeht",
    title: "nach 24 Stunden.",
    body: "Kein Profil zum Durchscrollen, keine Follower-Zahlen, keine Vergangenheit. Ein lebender Moment pro Person — und morgen ist er weg.",
  },
];

type Phase = "explain" | "handle" | "nudge";

export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const { profile } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("explain");
  // Ob die Erklär-Screens gelesen oder übersprungen wurden — bestimmt `via` beim
  // Abschluss-Event.
  const [skipped, setSkipped] = useState(false);

  // Wie der Flow verlassen wurde: durchgelesen vs. übersprungen. `via` ist ein
  // Enum (nur "read" | "skip") → 🔒 metadata-Regel gewahrt, keine Zahlen.
  function finish() {
    logEvent("onboarding_completed", { via: skipped ? "skip" : "read" }); // fire-and-forget
    onComplete();
  }

  // Nach den Erklär-Screens: Handle nur, wenn noch kein Profil da ist. Ein User
  // mit Profil (neues Gerät / geleerter Speicher, der den Flow erneut sieht)
  // überspringt den Handle-Schritt. „Überspringen" der Erklär-Screens
  // überspringt den Handle-Schritt NICHT (Handle bleibt Pflicht).
  function afterExplain(via: "read" | "skip") {
    setSkipped(via === "skip");
    setPhase(profile ? "nudge" : "handle");
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center px-8 bg-neutral-950"
      style={{
        // Der Flow liegt über dem Feed. Ohne das löst ein Wisch darauf das
        // native Seiten-Scrollen aus (siehe daily-prompt-splash.tsx).
        touchAction: "none",
      }}
    >
      <CityBackdrop extraDark />

      {phase === "explain" && (
        <ExplainStep
          screen={EXPLAINER_SCREENS[stepIndex]}
          index={stepIndex}
          total={EXPLAINER_SCREENS.length}
          onNext={() => {
            if (stepIndex < EXPLAINER_SCREENS.length - 1) {
              setStepIndex((i) => i + 1);
            } else {
              afterExplain("read");
            }
          }}
          onSkip={() => afterExplain("skip")}
        />
      )}

      {phase === "handle" && (
        <div className="relative z-10 w-full max-w-[22rem] rounded-[1.75rem] border border-white/10 bg-white/[0.06] px-7 py-8 text-center backdrop-blur-md shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
          <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            Wähl deinen Handle
          </h1>
          <p className="mt-3 text-sm text-white/60">
            Ein Gesicht, ein Handle. So findet dich deine Stadt.
          </p>
          <div className="mt-7 text-left">
            <OnboardingHandleStep onDone={() => setPhase("nudge")} />
          </div>
        </div>
      )}

      {phase === "nudge" && <NudgeStep onLater={finish} onNow={finish} />}
    </div>
  );
}

// Ein einzelner Erklär-Screen im Glas-Container-Look des Prompt-Splash, mit
// Fortschritts-Punkten (Muster: index.tsx:346), „Weiter" und einem sichtbaren,
// aber unaufdringlichen „Überspringen".
function ExplainStep({
  screen,
  index,
  total,
  onNext,
  onSkip,
}: {
  screen: { eyebrow: string; title: string; body: string };
  index: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const isLast = index === total - 1;
  return (
    <div className="relative z-10 flex w-full max-w-[22rem] flex-col items-center">
      <div className="w-full rounded-[1.75rem] border border-white/10 bg-white/[0.06] px-7 py-8 text-center backdrop-blur-md shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-white/50">
          {screen.eyebrow}
        </div>
        <h1 className="mt-4 text-[26px] font-semibold leading-snug tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          {screen.title}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-white/70">{screen.body}</p>
      </div>

      {/* Fortschritts-Punkte (horizontal) — Muster aus index.tsx:346 */}
      <div className="mt-6 flex items-center gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === index ? "w-6 bg-white" : "w-1.5 bg-white/30"
            }`}
          />
        ))}
      </div>

      <button
        onClick={onNext}
        className="mt-6 w-full max-w-[22rem] rounded-xl bg-white px-4 py-3 font-semibold text-black transition-opacity active:opacity-80"
      >
        {isLast ? "Verstanden" : "Weiter"}
      </button>
      <button
        onClick={onSkip}
        className="mt-4 text-xs text-white/40 transition-colors hover:text-white/70"
      >
        Überspringen
      </button>
    </div>
  );
}

// Abschluss: offene Einladung zum ersten Moment (nicht erzwungen). Beide Wege
// setzen den Merker und beenden den Flow — „Jetzt aufnehmen" navigiert nach
// /record, „Später" fällt einfach in die App.
function NudgeStep({ onLater, onNow }: { onLater: () => void; onNow: () => void }) {
  return (
    <div className="relative z-10 flex w-full max-w-[22rem] flex-col items-center">
      <div className="w-full rounded-[1.75rem] border border-white/10 bg-white/[0.06] px-7 py-8 text-center backdrop-blur-md shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-white/50">
          Du bist dabei
        </div>
        {/* TODO: Text-/Design-Pass — Entwurf. */}
        <h1 className="mt-4 text-[26px] font-semibold leading-snug tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          Nimm jetzt deinen ersten Moment auf.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-white/70">
          Kurz, roh, echt — genau so, wie du gerade bist. Deine Stadt sieht dich nur, wenn du da
          bist.
        </p>
      </div>

      <Link
        to="/record"
        onClick={onNow}
        className="mt-6 inline-flex w-full max-w-[22rem] items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-semibold text-black transition-opacity active:opacity-80"
      >
        <span className="material-symbols-outlined text-[18px]">videocam</span>
        Moment aufnehmen
      </Link>
      <button
        onClick={onLater}
        className="mt-4 text-xs text-white/40 transition-colors hover:text-white/70"
      >
        Später
      </button>
    </div>
  );
}
