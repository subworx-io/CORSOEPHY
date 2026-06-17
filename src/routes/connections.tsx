import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFollow, type FollowedPerson } from "@/lib/follow-context";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "ich folge — Korso" },
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
  // hasPostedToday ist fix — ändert sich nicht wenn der User den Follow erneuert
  const hasPostedToday = person.followState !== "nudge";
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const isLockedRef = useRef(false);

  const goNext = useCallback(() => {
    if (isLockedRef.current) return;
    setCurrentIndex((i) => {
      if (i >= people.length - 1) return i;
      isLockedRef.current = true;
      setTimeout(() => { isLockedRef.current = false; }, 700);
      return i + 1;
    });
  }, []);

  const goPrev = useCallback(() => {
    if (isLockedRef.current) return;
    setCurrentIndex((i) => {
      if (i <= 0) return i;
      isLockedRef.current = true;
      setTimeout(() => { isLockedRef.current = false; }, 700);
      return i - 1;
    });
  }, []);

  // Trackpad / Mausrad
  useEffect(() => {
    let accumulated = 0;
    const threshold = 80;
    let resetId: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isLockedRef.current) { accumulated = 0; return; }
      accumulated += e.deltaY;
      if (resetId) clearTimeout(resetId);
      resetId = setTimeout(() => { accumulated = 0; }, 150);
      if (accumulated > threshold) { goNext(); accumulated = 0; }
      else if (accumulated < -threshold) { goPrev(); accumulated = 0; }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (resetId) clearTimeout(resetId);
    };
  }, [goNext, goPrev]);

  // Touch Swipe
  useEffect(() => {
    let startY = 0;
    let tracking = false;
    const onTouchStart = (e: TouchEvent) => { startY = e.touches[0].clientY; tracking = true; };
    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const diff = startY - e.changedTouches[0].clientY;
      if (diff > 60) goNext();
      else if (diff < -60) goPrev();
    };
    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [goNext, goPrev]);

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
              transition: "transform 0.7s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.5s ease",
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
