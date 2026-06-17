import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useFollow, type FollowedPerson } from "@/lib/follow-context";
import { useSnapScroll, SNAP_MS } from "@/hooks/use-snap-scroll";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "ich folge — Corso" },
      { name: "description", content: "Menschen denen du folgst." },
    ],
  }),
  component: ConnectionsPage,
});

type FollowState = FollowedPerson["followState"];

function HeartIcon({ filled, className = "" }: { filled: boolean; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined leading-none ${className}`}
      style={{ fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0" }}
    >
      favorite
    </span>
  );
}

function PersonSlide({ person, isActive }: { person: FollowedPerson; isActive: boolean }) {
  const [followState, setFollowState] = useState<FollowState>(person.followState);
  const [nudged, setNudged] = useState(false);
  // Post-Status und Follow-Status sind getrennt — Follow erneuern ändert nicht, ob heute gepostet wurde
  const hasPostedToday = person.hasPostedToday;
  const hasImage = person.src !== null && hasPostedToday;

  return (
    <div className="absolute inset-0 px-4 pt-6 pb-28">
      <div
        className="relative w-full h-full rounded-[2rem] overflow-hidden"
        style={{
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
        }}
      >
        {/* Bild oder leerer State */}
        {hasImage ? (
          <>
            <img
              src={person.src!}
              alt={person.handle}
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-[2rem]"
              style={{
                background: "linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.08) 100%)",
                mixBlendMode: "overlay",
              }}
            />
          </>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-4"
            style={{ background: "radial-gradient(circle at 50% 40%, rgba(255,255,255,0.05), transparent 65%), linear-gradient(160deg, #141414 0%, #080808 100%)" }}
          >
            <div className="w-20 h-20 rounded-full bg-white/8 border border-white/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-white/25 text-[36px]">person</span>
            </div>
            <p className="text-white/30 text-sm text-center leading-snug">
              Noch kein Moment<br />heute
            </p>
          </div>
        )}

        {/* Bottom overlay + Buttons */}
        <div className={`absolute bottom-0 left-0 right-0 p-5 flex flex-col gap-3 ${hasImage ? "bg-gradient-to-t from-black/80 via-black/30 to-transparent" : ""}`}>
          <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
            {person.handle}
          </span>

          {/* Noch nicht gepostet heute: anstupsen + follow erneuern/erneuert */}
          {!hasPostedToday ? (
            <div className="flex gap-2">
              <button
                onClick={() => setNudged(true)}
                disabled={nudged}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                  nudged
                    ? "bg-white/10 text-white/40"
                    : "bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25"
                }`}
              >
                <span className="material-symbols-outlined text-[16px] leading-none">notification_add</span>
                {nudged ? "angestupst" : "anstupsen"}
              </button>
              <button
                onClick={() => setFollowState("renewed")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                  followState === "renewed"
                    ? "bg-white text-black"
                    : "bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25"
                }`}
              >
                <HeartIcon filled={followState === "renewed"} className="text-[16px]" />
                {followState === "renewed" ? "follow erneuert" : "follow erneuern"}
              </button>
            </div>
          ) : (
            <>
              {followState === "today" && (
                <button className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full text-sm font-semibold bg-white text-black transition-all active:scale-95">
                  <HeartIcon filled className="text-[16px]" />
                  heute gefolgt
                </button>
              )}
              {followState === "renewed" && (
                <button className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full text-sm font-semibold bg-white text-black transition-all active:scale-95">
                  <HeartIcon filled className="text-[16px]" />
                  follow erneuert
                </button>
              )}
              {followState === "renew" && (
                <button
                  onClick={() => setFollowState("renewed")}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full text-sm font-semibold bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25 transition-all active:scale-95"
                >
                  <HeartIcon filled={false} className="text-[16px]" />
                  follow erneuern
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionsPage() {
  const { followed } = useFollow();
  const people = Array.from(followed.values());
  const { currentIndex } = useSnapScroll({ count: people.length, axis: "y" });

  if (people.length === 0) {
    return (
      <div className="relative h-dvh w-full flex flex-col items-center justify-center bg-neutral-950 px-8 text-center">
        <div className="w-20 h-20 rounded-full bg-white/8 border border-white/10 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-white/25 text-[36px]">explore</span>
        </div>
        <p className="text-white text-lg font-semibold tracking-tight">Noch niemand</p>
        <p className="mt-2 text-white/40 text-sm leading-snug max-w-[15rem]">
          Folge Menschen in der Discovery — sie erscheinen hier, bis ihr Publikum verfällt.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      {people.map((person, i) => {
        const offset = i - currentIndex;
        const isActive = offset === 0;
        const clampedOffset = Math.max(-1, Math.min(1, offset));
        const isNeighbor = Math.abs(offset) === 1;

        return (
          <div
            key={person.handle}
            className="absolute inset-0 w-full h-full"
            style={{
              transform: `translateY(${clampedOffset * 100}%)`,
              opacity: isActive || isNeighbor ? 1 : 0,
              zIndex: isActive ? 10 : 5,
              transition: `transform ${SNAP_MS}ms cubic-bezier(0.2,0.9,0.25,1), opacity ${SNAP_MS - 80}ms ease`,
              willChange: "transform, opacity",
            }}
          >
            <PersonSlide person={person} isActive={isActive} />
          </div>
        );
      })}

      {/* Seitenindikatoren */}
      <div className="absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col gap-1.5">
        {people.map((_, i) => (
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
