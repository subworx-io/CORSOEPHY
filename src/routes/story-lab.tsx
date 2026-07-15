import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PORTRAITS } from "@/assets/portraits";
import { useSnapScroll } from "@/hooks/use-snap-scroll";

// ─────────────────────────────────────────────────────────────────────────────
// STORY-LAB — Sandbox zum visuellen Experimentieren (z. B. in Lovable).
//
// Diese Route ist ABSICHTLICH eigenständig: keine Supabase-Query, kein Auth, kein
// signiertes Video — nur Mock-Bilder. So rendert sie überall sofort und du kannst
// gefahrlos am Look schrauben. Sie beeinflusst den echten Story-Screen NICHT.
//
// Wenn dir das Layout gefällt: Bescheid geben, dann wird der visuelle Teil in den
// echten `src/routes/story.tsx` übernommen (dort bleibt die Backend-Verdrahtung).
// Route erreichbar unter /story-lab
// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/story-lab")({
  head: () => ({
    meta: [{ title: "Story-Lab (Vorschau) — Corso" }],
  }),
  component: StoryLabPage,
});

interface MockClip {
  id: string;
  handle: string;
  src: string;
  caption: string;
}

const MOCK_CLIPS: MockClip[] = [
  { id: "c1", handle: "@felix.rhein", src: PORTRAITS.felixRhein, caption: "Am Burgplatz" },
  { id: "c2", handle: "@mia.galerie", src: PORTRAITS.miaGalerie, caption: "In der Galerie" },
  { id: "c3", handle: "@clara.mondo", src: PORTRAITS.claraMondo, caption: "An der Königsallee" },
  { id: "c4", handle: "@david.arch", src: PORTRAITS.davidArch, caption: "Auf der Brücke" },
  { id: "c5", handle: "@leo.see", src: PORTRAITS.leoWild, caption: "Am Rhein" },
  { id: "c6", handle: "@jannis.lux", src: PORTRAITS.jannisLux, caption: "Vor dem Schauspielhaus" },
  { id: "c7", handle: "@sara.sound", src: PORTRAITS.saraSound, caption: "Im Hofgarten" },
  { id: "c8", handle: "@nina.pure", src: PORTRAITS.ninaPure, caption: "In der Altstadt" },
];

const CITY = "Düsseldorf";

/* Rein visueller Folgen-Button (kein Backend) — nur fürs Lab. */
function MockFollowButton() {
  const [following, setFollowing] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setFollowing((f) => !f)}
      className={`inline-flex items-center gap-1.5 h-9 rounded-full px-4 text-sm font-semibold transition-all active:scale-95 ${
        following ? "bg-white/15 text-white" : "bg-white text-black"
      }`}
    >
      <span className="material-symbols-outlined text-[18px] leading-none">
        {following ? "check" : "favorite"}
      </span>
      {following ? "Folge ich" : "Folgen"}
    </button>
  );
}

function StoryLabPage() {
  const { currentIndex, slideRef } = useSnapScroll({ count: MOCK_CLIPS.length, axis: "y" });

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950" style={{ touchAction: "none" }}>
      {MOCK_CLIPS.map((c, i) => {
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
            {/* Gerahmte Karte */}
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
                <img src={c.src} alt={c.caption} className="w-full h-full object-cover" draggable={false} />

                {/* Gradient-Ring-Overlay */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-[2rem]"
                  style={{
                    background:
                      "linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.08) 100%)",
                    mixBlendMode: "overlay",
                  }}
                />

                {/* Bottom overlay — Ort + Handle + Folgen.
                    🔒 KEINE Follower-/Reaktions-Zahlen (wie im echten Screen). */}
                <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                  <div className="flex items-center gap-1.5 text-white/70 mb-2.5">
                    <span className="material-symbols-outlined text-[16px] leading-none">location_on</span>
                    <span className="text-xs font-medium tracking-tight">{CITY}</span>
                    <span className="text-white/40 text-xs">· Stadt-Story</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
                      {c.handle}
                    </span>
                    <MockFollowButton />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Seitenindikatoren */}
      <div className="absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col gap-1.5">
        {MOCK_CLIPS.map((c, i) => (
          <div
            key={c.id}
            className={`w-1.5 rounded-full transition-all duration-300 ${
              i === currentIndex ? "h-6 bg-white shadow-lg" : "h-1.5 bg-white/40"
            }`}
          />
        ))}
      </div>

      <LabBadge />
      <SwipeHint />
    </div>
  );
}

/* Kleiner Hinweis, dass das die Vorschau ist (nicht der echte Screen). */
function LabBadge() {
  return (
    <div
      className="absolute left-4 z-30 rounded-full bg-amber-400/90 px-3 py-1 text-[11px] font-semibold text-black"
      style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
    >
      Story-Lab · Vorschau
    </div>
  );
}

function SwipeHint() {
  const [visible, setVisible] = useState(true);
  const seen = useRef(false);
  useEffect(() => {
    const onInteraction = () => {
      if (seen.current) return;
      seen.current = true;
      setVisible(false);
    };
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
