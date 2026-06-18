import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PORTRAITS } from "@/assets/portraits";
import skylineUrl from "@/assets/duesseldorf-skyline.jpg";
import { useFollow } from "@/lib/follow-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { FollowButton } from "@/components/follow-button";
import { HeartBurst, useHeartBurst } from "@/components/heart-burst";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Corso — deine Stadt heute Abend" },
      { name: "description", content: "Jeden Abend geht deine Stadt gemeinsam spazieren. Echte Momente, echte Menschen." },
      { property: "og:title", content: "Corso — deine Stadt heute Abend" },
      { property: "og:description", content: "Jeden Abend geht deine Stadt gemeinsam spazieren." },
    ],
  }),
  component: Index,
});

type Tile = { handle: string; src: string; alt: string };
type CountdownSlide = { kind: "countdown" };
type TileSlide = { kind: "tile" } & Tile;
type Slide = CountdownSlide | TileSlide;

// Stadt-Story ist jeden Tag um 20:00 — Countdown läuft auf die nächste 20:00 und rollt danach automatisch weiter
function nextStoryTarget(now: number) {
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  if (now >= target.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function useCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, nextStoryTarget(now) - now);
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { hours, minutes, seconds };
}

const pad = (n: number) => n.toString().padStart(2, "0");

// Discovery zeigt immer neue, unbekannte Personen aus der Stadt — kein Overlap mit "ich folge"
const TILES: Tile[] = [
  { handle: "@felix.rhein",   src: PORTRAITS.felixRhein,   alt: "Black-and-white street portrait of a man with beard and sunglasses." },
  { handle: "@mia.galerie",   src: PORTRAITS.miaGalerie,   alt: "Black-and-white street portrait of a woman walking in the city." },
  { handle: "@jan.motor",     src: PORTRAITS.jannisLux,    alt: "1960s retro motorsport fashion editorial." },
  { handle: "@clara.mondo",   src: PORTRAITS.claraMondo,   alt: "Black-and-white portrait of a woman sitting on a curb." },
  { handle: "@paul.altstadt", src: PORTRAITS.paulAltstadt, alt: "Black-and-white night portrait of a man on a city street." },
  { handle: "@lena.rhein",    src: PORTRAITS.saraSound,    alt: "Close-up editorial portrait with braids and feathered collar." },
  { handle: "@david.bruecke", src: PORTRAITS.davidArch,    alt: "Black-and-white street portrait of a man with beard and aviator sunglasses." },
  { handle: "@nina.medien",   src: PORTRAITS.ninaPure,     alt: "Editorial portrait grid of a young man in studio light." },
  { handle: "@leo.see",       src: PORTRAITS.leoWild,      alt: "Atmospheric sepia-toned portrait in a foggy field." },
];

const buildSlides = (tiles: Tile[]): Slide[] => [
  { kind: "countdown" },
  ...tiles.map((t) => ({ kind: "tile" as const, ...t })),
];

// Dauer, die eine gerade gefolgte Kachel noch sichtbar bleibt: Herz-Burst (700ms) + Wegblenden.
const EXIT_MS = 1100;

function Index() {
  const { burstHandle, triggerBurst } = useHeartBurst();
  const { hours, minutes, seconds } = useCountdown();

  // Discovery zeigt nur Fremde (PRD §4.4): wem du folgst, verlässt den Feed.
  // Reaktiv auf den Follow-State — nicht am Mount eingefroren, damit das Verhalten
  // überall gleich ist (kein "bleibt diese Session, weg nach Navigation"-Zufall mehr).
  const { followed, reset } = useFollow();
  // `exiting` hält eine gerade gefolgte Kachel kurz im Feed, damit sie sichtbar
  // rausgleiten kann, statt unter dem Finger zu verschwinden.
  const [exiting, setExiting] = useState<Set<string>>(() => new Set());

  const slides = useMemo(
    () => buildSlides(TILES.filter((t) => !followed.has(t.handle) || exiting.has(t.handle))),
    [followed, exiting]
  );

  // Nach dem Follow: Herz zeigen, dann die Kachel aus Discovery gleiten lassen.
  // Die Person ist durch follow() bereits in "Ich folge" — hier geht es nur ums Ausblenden.
  const handleFollowed = (handle: string) => {
    triggerBurst(handle);
    setExiting((prev) => new Set(prev).add(handle));
    setTimeout(() => {
      setExiting((prev) => {
        const next = new Set(prev);
        next.delete(handle);
        return next;
      });
    }, EXIT_MS);
  };

  const { currentIndex, slideRef } = useSnapScroll({ count: slides.length, axis: "y" });

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950" style={{ touchAction: "none" }}>
      {/* Slides */}
      {slides.map((slide, i) => {
        const offset = i - currentIndex;
        const isActive = offset === 0;
        const isNeighbor = Math.abs(offset) === 1;
        const isExiting = slide.kind === "tile" && exiting.has(slide.handle);

        return (
          <div
            key={slide.kind === "countdown" ? "__countdown" : slide.handle}
            ref={slideRef(i)}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: isActive ? 10 : isNeighbor ? 5 : 0 }}
          >
            <div
              className="absolute inset-0 px-4"
              style={{
                paddingTop: "calc(env(safe-area-inset-top) + 2.5rem)",
                paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
                // Wegblenden erst nach dem Herz-Burst (Delay 600ms), dann sanft schrumpfen.
                opacity: isExiting ? 0 : 1,
                transform: isExiting ? "scale(0.9)" : "scale(1)",
                transition: "opacity 450ms ease 600ms, transform 450ms ease 600ms",
              }}
            >
              <div
                className="relative w-full h-full rounded-[2rem] overflow-hidden"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
                }}
              >
                {slide.kind === "tile" ? (
                  <>
                    <img
                      src={slide.src}
                      alt={slide.alt}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    {/* gradient ring overlay */}
                    <div
                      className="pointer-events-none absolute inset-0 rounded-[2rem]"
                      style={{
                        background:
                          "linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.08) 100%)",
                        mixBlendMode: "overlay",
                      }}
                    />
                    {/* Herzanimation mittig über dem Bild */}
                    {burstHandle === slide.handle && (
                      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                        <span
                          className="material-symbols-outlined animate-heart-burst text-white"
                          style={{ fontSize: "100px", fontVariationSettings: "'FILL' 1" }}
                        >
                          favorite
                        </span>
                      </div>
                    )}
                    {/* Bottom overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                      <div className="flex justify-between items-end">
                        <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
                          {slide.handle}
                        </span>
                        <FollowButton handle={slide.handle} src={slide.src} onBurst={() => handleFollowed(slide.handle)} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div
                    className="w-full h-full flex flex-col items-center justify-center text-white relative"
                    style={{
                      background:
                        "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.08), transparent 60%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.04), transparent 55%), linear-gradient(160deg, #111 0%, #050505 100%)",
                    }}
                  >
                    {/* Düsseldorf-Skyline als dezenter Backdrop (PRD-fern, reine Atmosphäre) */}
                    <img
                      src={skylineUrl}
                      alt=""
                      aria-hidden
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
                      draggable={false}
                    />
                    {/* Radial-Overlay hält den Countdown in der Mitte lesbar */}
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background:
                          "radial-gradient(circle at 50% 45%, rgba(5,5,5,0.85) 0%, rgba(5,5,5,0.55) 35%, transparent 70%)",
                      }}
                    />
                    <div className="relative z-10 text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6 font-medium">
                      Corso — Stadt-Story um 20:00
                    </div>
                    <div className="relative z-10 flex items-end gap-3 tabular-nums">
                      {[
                        { v: pad(hours), l: "Std" },
                        { v: pad(minutes), l: "Min" },
                        { v: pad(seconds), l: "Sek" },
                      ].map((u, idx) => (
                        <div key={u.l} className="flex items-end gap-3">
                          <div className="flex flex-col items-center">
                            <span className="text-5xl font-semibold tracking-tight">{u.v}</span>
                            <span className="text-[10px] uppercase tracking-[0.25em] text-white/40 mt-2 font-medium">{u.l}</span>
                          </div>
                          {idx < 2 && <span className="text-3xl font-semibold text-white/30 pb-6">:</span>}
                        </div>
                      ))}
                    </div>
                    <div className="absolute bottom-8 left-0 right-0 z-10 flex flex-col items-center gap-2 text-white/40">
                      <span className="material-symbols-outlined animate-bounce text-[28px]">keyboard_arrow_up</span>
                      <span className="text-[11px] tracking-widest uppercase font-medium">Swipe</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Page indicators */}
      <div className="absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col gap-1.5">
        {slides.map((_, i) => (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-all duration-300 ${
              i === currentIndex ? "h-6 bg-white shadow-lg" : "h-1.5 bg-white/40"
            }`}
          />
        ))}
      </div>

      {/* Top bar — safe-area-inset-top verhindert Konflikt mit Notch/Dynamic Island */}
      <header className="absolute top-0 left-0 right-0 z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="flex justify-end items-center gap-4 px-6 h-14 max-w-[600px] mx-auto">
          {/* Dev/Test: setzt Follows + persistierten Stand auf den Demo-Ausgang zurück */}
          <button
            onClick={() => reset()}
            className="flex items-center text-white/70 hover:text-white active:scale-95 transition-all drop-shadow-md"
            aria-label="App zurücksetzen"
            title="App zurücksetzen"
          >
            <span className="material-symbols-outlined">restart_alt</span>
          </button>
          <button className="flex items-center gap-2 text-white active:scale-95 transition-transform drop-shadow-md" aria-label="Einstellungen">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>

    </div>
  );
}
