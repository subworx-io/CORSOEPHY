import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PORTRAITS } from "@/assets/portraits";
import { useFollow } from "@/lib/follow-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";

export const Route = createFileRoute("/story")({
  head: () => ({
    meta: [
      { title: "Stadt-Story — Corso" },
      { name: "description", content: "20:00 — Deine Stadt enthüllt sich." },
    ],
  }),
  component: StoryPage,
});

/* ---- Demo clips (reuse existing imagery) ---- */
interface Clip {
  id: string;
  handle: string;
  src: string;
  city: string;
  time: string;
  caption: string;
}

// 🔒 Stadt-Story = genau 8 Momente (PRD 4.6). Handles konsistent zur Discovery.
const CLIPS: Clip[] = [
  { id: "c1", handle: "@felix.rhein",   src: PORTRAITS.felixRhein,   city: "Düsseldorf", time: "20:00", caption: "Am Burgplatz" },
  { id: "c2", handle: "@mia.galerie",   src: PORTRAITS.miaGalerie,   city: "Düsseldorf", time: "20:00", caption: "In der Galerie" },
  { id: "c3", handle: "@clara.mondo",   src: PORTRAITS.claraMondo,   city: "Düsseldorf", time: "20:00", caption: "An der Königsallee" },
  { id: "c4", handle: "@david.bruecke", src: PORTRAITS.davidArch, city: "Düsseldorf", time: "20:00", caption: "Auf der Brücke" },
  { id: "c5", handle: "@leo.see",       src: PORTRAITS.leoWild,   city: "Düsseldorf", time: "20:00", caption: "Am Rhein" },
  { id: "c6", handle: "@jan.motor",     src: PORTRAITS.jannisLux, city: "Düsseldorf", time: "20:00", caption: "Vor dem Schauspielhaus" },
  { id: "c7", handle: "@lena.rhein",    src: PORTRAITS.saraSound, city: "Düsseldorf", time: "20:00", caption: "Im Hofgarten" },
  { id: "c8", handle: "@nina.medien",   src: PORTRAITS.ninaPure,  city: "Düsseldorf", time: "20:00", caption: "In der Altstadt" },
];

function StoryPage() {
  const { currentIndex: index, slideRef } = useSnapScroll({ count: CLIPS.length, axis: "x" });
  const { isFollowing, follow } = useFollow();
  const [burstHandle, setBurstHandle] = useState<string | null>(null);

  const handleFollow = (c: Clip) => {
    if (isFollowing(c.handle)) return;
    follow({ handle: c.handle, src: c.src });
    setBurstHandle(c.handle);
    setTimeout(() => setBurstHandle(null), 700);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950" style={{ touchAction: "none" }}>
      {/* Clips (horizontal stack) */}
      <div className="absolute inset-0 flex">
        {CLIPS.map((c, i) => {
          const offset = i - index;
          const isActive = offset === 0;
          const following = isFollowing(c.handle);

          return (
            <div
              key={c.id}
              ref={slideRef(i)}
              className="absolute inset-0 w-full h-full"
              style={{ zIndex: isActive ? 10 : Math.abs(offset) === 1 ? 5 : 0 }}
            >
              <img
                src={c.src}
                alt={c.caption}
                className="w-full h-full object-cover"
                draggable={false}
              />

              {/* Gradient overlays for readability */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.06) 100%)",
                  mixBlendMode: "overlay",
                }}
              />

              {/* Herz-Burst beim Folgen */}
              {burstHandle === c.handle && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                  <span
                    className="material-symbols-outlined animate-heart-burst text-white"
                    style={{ fontSize: "100px", fontVariationSettings: "'FILL' 1" }}
                  >
                    favorite
                  </span>
                </div>
              )}

              {/* Top-left metadata */}
              <div className="absolute top-6 left-6 z-20">
                <div className="flex items-center gap-2 text-white/90">
                  <span className="material-symbols-outlined text-[18px]">location_on</span>
                  <span className="text-sm font-medium tracking-tight">{c.city}</span>
                </div>
                <div className="mt-1 text-white/50 text-[11px] uppercase tracking-[0.25em] font-medium">
                  {c.time}
                </div>
              </div>

              {/* Bottom caption + follow */}
              <div className="absolute bottom-0 left-0 right-0 z-20 p-6">
                <div className="flex items-end justify-between gap-4">
                  <p className="text-white text-lg font-medium tracking-tight drop-shadow-md max-w-[70%]">
                    {c.caption}
                  </p>
                  <button
                    onClick={() => handleFollow(c)}
                    disabled={following}
                    className={`shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                      following
                        ? "bg-white text-black"
                        : "bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25"
                    }`}
                  >
                    {following ? "folgst du" : "Folgen"}
                    <span
                      className="material-symbols-outlined text-[18px] leading-none"
                      style={{ fontVariationSettings: following ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      favorite
                    </span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress dots — safe-area-inset-top für Notch */}
      <div className="absolute right-6 z-30 flex gap-1.5" style={{ top: "calc(env(safe-area-inset-top, 0px) + 24px)" }}>
        {CLIPS.map((_, i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-all duration-300 ${
              i === index ? "w-6 bg-white" : "w-1.5 bg-white/40"
            }`}
          />
        ))}
      </div>

      {/* Swipe hint (fades out after first interaction) */}
      <SwipeHint />
    </div>
  );
}

function SwipeHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onInteraction = () => setVisible(false);
    window.addEventListener("touchstart", onInteraction, { once: true });
    window.addEventListener("mousedown", onInteraction, { once: true });
    return () => {
      window.removeEventListener("touchstart", onInteraction);
      window.removeEventListener("mousedown", onInteraction);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="absolute bottom-24 left-0 right-0 z-30 flex justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-1 text-white/40 animate-pulse">
        <span className="material-symbols-outlined text-[24px]">swipe_left</span>
        <span className="text-[11px] uppercase tracking-widest font-medium">Wischen</span>
      </div>
    </div>
  );
}
