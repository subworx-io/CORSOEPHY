import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PORTRAITS } from "@/assets/portraits";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { FollowButton } from "@/components/follow-button";
import { HeartBurst, useHeartBurst } from "@/components/heart-burst";

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
  // Gleiche Scroll-UX wie Discovery: vertikales Snap-Scrollen.
  const { currentIndex, slideRef } = useSnapScroll({ count: CLIPS.length, axis: "y" });
  const { burstHandle, triggerBurst } = useHeartBurst();

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950" style={{ touchAction: "none" }}>
      {CLIPS.map((c, i) => {
        const offset = i - currentIndex;
        const isActive = offset === 0;
        const isNeighbor = Math.abs(offset) === 1;

        return (
          <div
            key={c.id}
            ref={slideRef(i)}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: isActive ? 10 : isNeighbor ? 5 : 0 }}
          >
            {/* Gerahmte Karte wie in der Discovery */}
            <div
              className="absolute inset-0 px-4"
              style={{
                paddingTop: "calc(env(safe-area-inset-top) + 2.5rem)",
                paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
              }}
            >
              <div
                className="relative w-full h-full rounded-[2rem] overflow-hidden"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
                }}
              >
                <img
                  src={c.src}
                  alt={c.caption}
                  className="w-full h-full object-cover"
                  draggable={false}
                />

                {/* Gradient-Ring-Overlay (identisch zur Discovery) */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-[2rem]"
                  style={{
                    background:
                      "linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.08) 100%)",
                    mixBlendMode: "overlay",
                  }}
                />

                {/* Herz-Burst beim Folgen — geteilt mit Discovery */}
                <HeartBurst active={burstHandle === c.handle} />

                {/* Bottom overlay — Ort/Zeit + Caption + Handle + Folgen */}
                <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                  <div className="flex items-center gap-1.5 text-white/70 mb-1.5">
                    <span className="material-symbols-outlined text-[16px] leading-none">location_on</span>
                    <span className="text-xs font-medium tracking-tight">{c.city}</span>
                    <span className="text-white/40 text-xs">· {c.time}</span>
                  </div>
                  <p className="text-white/90 text-sm tracking-tight mb-2.5">{c.caption}</p>
                  <div className="flex justify-between items-end">
                    <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
                      {c.handle}
                    </span>
                    <FollowButton handle={c.handle} src={c.src} onBurst={() => triggerBurst(c.handle)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Seitenindikatoren — identisch zur Discovery */}
      <div className="absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col gap-1.5">
        {CLIPS.map((_, i) => (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-all duration-300 ${
              i === currentIndex ? "h-6 bg-white shadow-lg" : "h-1.5 bg-white/40"
            }`}
          />
        ))}
      </div>

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
    <div className="absolute bottom-28 left-0 right-0 z-30 flex justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-1 text-white/40 animate-pulse">
        <span className="material-symbols-outlined text-[24px]">keyboard_arrow_up</span>
        <span className="text-[11px] uppercase tracking-widest font-medium">Wischen</span>
      </div>
    </div>
  );
}
