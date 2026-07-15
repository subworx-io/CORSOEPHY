import { useEffect, useRef, useState } from "react";

// Wiederverwendbarer Stadt-Hintergrund: geblurrte, schwarz-weiße Düsseldorf-Clips
// in fester Reihenfolge (harte Cuts), plus Vignette, Blue-Hour-Tint und feines Grain.
// Exakt der Look aus dem Story-Empty-Lab, hier extrahiert, damit Splash & Story ihn
// teilen. Clips liegen in public/ (empty-bg-4…9.mp4) → in Dev und Deploy identisch.

const CLIPS = [
  "/empty-bg-4.mp4",
  "/empty-bg-5.mp4",
  "/empty-bg-6.mp4",
  "/empty-bg-7.mp4",
  "/empty-bg-8.mp4",
  "/empty-bg-9.mp4",
];
const HOLD_MS = 1600;

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
        transition: "none", // harte Cuts zwischen den Clips
        filter: "grayscale(1) contrast(1.05) brightness(0.7) blur(5px)",
        transform: "scale(1.25)",
        transformOrigin: "center",
      }}
    />
  );
}

// extraDark: zusätzliche dunkle Ebene, damit weiße Schrift (z.B. im Splash) klarer
// lesbar ist, ohne den Grundlook zu verändern.
export function CityBackdrop({ extraDark = false }: { extraDark?: boolean }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % CLIPS.length);
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {CLIPS.map((src, i) => (
        <BgVideo key={src} src={src} visible={i === active} />
      ))}

      {/* Dunkler Vignette-Scrim */}
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
      {/* Feines animiertes Grain */}
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
      {/* Optional einen Tick dunkler für weiße Schrift */}
      {extraDark && <div className="pointer-events-none absolute inset-0 bg-black/35" />}

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
  );
}
