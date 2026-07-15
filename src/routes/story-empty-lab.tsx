import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// STORY-EMPTY-LAB — Sandbox NUR für den Leerzustand der Stadt-Story.
// Self-contained, kein Supabase / kein Auth. Route: /story-empty-lab
//
// Hintergrund-Clips liegen in public/ (empty-bg-4…9.mp4) und werden per
// absolutem Pfad geladen — so funktioniert es in Dev und im Cloudflare-Deploy
// identisch (public/ → dist/client/).
//
// Wenn dir das Ergebnis gefällt → Bescheid geben, dann wird der Look in den
// echten `StoryEmpty` in src/routes/story.tsx übernommen.
// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/story-empty-lab")({
  head: () => ({
    meta: [{ title: "Story-Empty-Lab (Vorschau) — Corso" }],
  }),
  component: StoryEmptyLab,
});

const CITY = "Düsseldorf";
const CLIPS = [
  "/empty-bg-4.mp4",
  "/empty-bg-5.mp4",
  "/empty-bg-6.mp4",
  "/empty-bg-7.mp4",
  "/empty-bg-8.mp4",
  "/empty-bg-9.mp4",
];
const HOLD_MS = 1600;

// Nächste 20:00 — Ziel des Countdowns, solange die Story noch nicht läuft.
function nextStoryTarget(now: number): number {
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  if (now >= target.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function useTimeLeft(targetOf: (now: number) => number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const diff = Math.max(0, targetOf(now) - now);
  return {
    hours: Math.floor(diff / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

const pad = (n: number) => n.toString().padStart(2, "0");

function StoryCountdown() {
  const { hours, minutes, seconds } = useTimeLeft(nextStoryTarget);

  return (
    <div className="flex items-end gap-3 tabular-nums">
      {[
        { v: pad(hours), l: "Std" },
        { v: pad(minutes), l: "Min" },
        { v: pad(seconds), l: "Sek" },
      ].map((u, idx) => (
        <div key={u.l} className="flex items-end gap-3">
          <div className="flex flex-col items-center">
            <span className="text-5xl font-semibold tracking-tight text-white">{u.v}</span>
            <span className="text-[10px] uppercase tracking-[0.25em] text-white/40 mt-2 font-medium">
              {u.l}
            </span>
          </div>
          {idx < 2 && <span className="text-3xl font-semibold text-white/30 pb-6">:</span>}
        </div>
      ))}
    </div>
  );
}

function StoryEmptyLab() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    // Immer dieselbe Reihenfolge, endlos geloopt.
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % CLIPS.length);
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950 flex items-center justify-center px-8">
      {/* ── Hintergrund: cross-fadende Düsseldorf-Clips, s/w, körnig, unscharf ── */}
      <div className="absolute inset-0 overflow-hidden">
        {CLIPS.map((src, i) => (
          <BgVideo key={src} src={src} visible={i === active} />
        ))}

        {/* Dunkler Vignette-Scrim, damit Text lesbar bleibt */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 50%, rgba(5,5,10,0.35) 0%, rgba(5,5,10,0.75) 60%, rgba(5,5,10,0.95) 100%)",
          }}
        />
        {/* Blue-hour Tint */}
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-60"
          style={{
            background:
              "linear-gradient(180deg, rgba(20,30,60,0.35) 0%, rgba(0,0,0,0) 60%)",
          }}
        />
        {/* Grain — feines animiertes Rauschen via SVG.
            WICHTIG: Div über den Rand hinaus (-inset), damit die Animation
            keinen sichtbaren Rahmen an den Kanten erzeugt. Animiert wird
            background-position, nicht transform. */}
        <div
          className="pointer-events-none absolute -inset-8 opacity-[0.22] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
            backgroundSize: "240px 240px",
            backgroundRepeat: "repeat",
            animation: "grain 1.2s steps(6) infinite",
          }}
        />
        <style>{`
          @keyframes grain {
            0%   { background-position: 0px 0px; }
            20%  { background-position: -40px 30px; }
            40%  { background-position: 30px -20px; }
            60%  { background-position: -20px -35px; }
            80%  { background-position: 35px 15px; }
            100% { background-position: 0px 0px; }
          }
        `}</style>
      </div>

      {/* ── AB HIER ist der eigentliche Leerzustand ── */}
      <div className="relative z-10 flex flex-col items-center text-center gap-6 text-white/70">
        <span className="material-symbols-outlined text-[40px] text-white/50">
          nights_stay
        </span>

        <div className="flex flex-col items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.4em] text-white/50 font-medium">
            Stadt-Story um 20:00
          </span>
          <StoryCountdown />
        </div>

        <p className="text-sm text-white/60 max-w-xs">
          Um 20:00 enthüllt sich {CITY}. Dann zeigt die ganze Stadt dieselben
          Momente von heute.
        </p>
      </div>
      {/* ── BIS HIER ── */}

      {/* Kleiner Vorschau-Hinweis (nicht Teil des echten Screens) */}
      <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-white/30">
        Empty-Lab · Vorschau
      </div>
    </div>
  );
}

function BgVideo({ src, visible }: { src: string; visible: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (visible) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }, [visible]);

  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-cover"
      style={{
        opacity: visible ? 1 : 0,
        // Kein Crossfade — harte Cuts zwischen den Clips.
        transition: "none",
        // Grayscale + Kontrast + kräftig Blur; Skalierung großzügig, damit die
        // weichen Blur-Kanten nicht als Rahmen am Rand sichtbar werden.
        filter: "grayscale(1) contrast(1.05) brightness(0.7) blur(5px)",
        transform: "scale(1.25)",
        transformOrigin: "center",
      }}
    />
  );
}
