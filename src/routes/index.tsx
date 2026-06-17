import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PORTRAITS } from "@/assets/portraits";
import { useFollow } from "@/lib/follow-context";
import { useSnapScroll, SNAP_MS } from "@/hooks/use-snap-scroll";

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
  { handle: "@felix.rhein",   src: PORTRAITS.eliasFashion, alt: "High-fashion editorial portrait in a concrete studio." },
  { handle: "@mia.galerie",   src: PORTRAITS.miaGalerie,   alt: "Black-and-white street portrait of a woman walking in the city." },
  { handle: "@jan.motor",     src: PORTRAITS.jannisLux,    alt: "1960s retro motorsport fashion editorial." },
  { handle: "@clara.mondo",   src: PORTRAITS.claraMondo,   alt: "Black-and-white portrait of a woman sitting on a curb." },
  { handle: "@paul.altstadt", src: PORTRAITS.paulAltstadt, alt: "Black-and-white street portrait of a man walking in the city." },
  { handle: "@lena.rhein",    src: PORTRAITS.saraSound,    alt: "Close-up editorial portrait with braids and feathered collar." },
  { handle: "@david.bruecke", src: PORTRAITS.davidArch,    alt: "Monochrome street portrait with sunglasses." },
  { handle: "@nina.medien",   src: PORTRAITS.ninaPure,     alt: "Editorial portrait grid of a young man in studio light." },
  { handle: "@leo.see",       src: PORTRAITS.leoWild,      alt: "Atmospheric sepia-toned portrait in a foggy field." },
];

const buildSlides = (tiles: Tile[]): Slide[] => [
  { kind: "countdown" },
  ...tiles.map((t) => ({ kind: "tile" as const, ...t })),
];

function FollowButton({ handle, src, onBurst }: { handle: string; src: string; onBurst: () => void }) {
  const { isFollowing, follow } = useFollow();
  const following = isFollowing(handle);

  const handleFollow = () => {
    if (following) return;
    follow({ handle, src });
    onBurst();
  };

  return (
    <button
      onClick={handleFollow}
      className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-full transition-all active:scale-95 ${
        following
          ? "bg-white text-black"
          : "bg-white/15 backdrop-blur-sm text-white border border-white/30 hover:bg-white/25"
      }`}
    >
      {following ? "folgst du" : "Folgen"}
      <span
        className="material-symbols-outlined text-[16px] leading-none"
        style={{ fontVariationSettings: following ? "'FILL' 1" : "'FILL' 0" }}
      >
        favorite
      </span>
    </button>
  );
}

function Index() {
  const [burstHandle, setBurstHandle] = useState<string | null>(null);
  const { hours, minutes, seconds } = useCountdown();

  // Discovery zeigt nur Fremde: Personen, denen du beim Öffnen schon folgst, werden ausgeblendet.
  // Folgst du jemandem während der Session, bleibt die Kachel sichtbar (Herz-Burst + "folgst du").
  const { followed } = useFollow();
  const [excludedHandles] = useState(() => new Set(followed.keys()));
  const slides = useMemo(
    () => buildSlides(TILES.filter((t) => !excludedHandles.has(t.handle))),
    [excludedHandles]
  );

  const { currentIndex } = useSnapScroll({ count: slides.length, axis: "y" });

  const triggerBurst = (handle: string) => {
    setBurstHandle(handle);
    setTimeout(() => setBurstHandle(null), 700);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950" style={{ touchAction: "none" }}>
      {/* Slides */}
      {slides.map((slide, i) => {
        const offset = i - currentIndex;
        const isActive = offset === 0;
        const clampedOffset = Math.max(-1, Math.min(1, offset));
        const isNeighbor = Math.abs(offset) === 1;

        return (
          <div
            key={slide.kind === "countdown" ? "__countdown" : slide.handle}
            className="absolute inset-0 w-full h-full"
            style={{
              transform: `translateY(${clampedOffset * 100}%)`,
              opacity: isActive || isNeighbor ? 1 : 0,
              zIndex: isActive ? 10 : 5,
              transition: `transform ${SNAP_MS}ms cubic-bezier(0.2,0.9,0.25,1), opacity ${SNAP_MS - 80}ms ease`,
              willChange: "transform, opacity",
            }}
          >
            <div className="absolute inset-0 px-4 pt-6 pb-28">
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
                        <FollowButton handle={slide.handle} src={slide.src} onBurst={() => triggerBurst(slide.handle)} />
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
                    <div className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6 font-medium">
                      Corso — Stadt-Story um 20:00
                    </div>
                    <div className="flex items-end gap-3 tabular-nums">
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
                    <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-2 text-white/40">
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

    </div>
  );
}
