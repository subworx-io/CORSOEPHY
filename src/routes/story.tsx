import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PORTRAITS } from "@/assets/portraits";

export const Route = createFileRoute("/story")({
  head: () => ({
    meta: [
      { title: "Stadt-Story — Korso" },
      { name: "description", content: "20:00 — Deine Stadt enthüllt sich." },
    ],
  }),
  component: StoryPage,
});

/* ---- Demo clips (reuse existing imagery) ---- */
interface Clip {
  id: string;
  src: string;
  city: string;
  time: string;
  caption: string;
}

const CLIPS: Clip[] = [
  {
    id: "c1",
    src: PORTRAITS.eliasFashion,
    city: "Düsseldorf",
    time: "20:00",
    caption: "Am Burgplatz",
  },
  {
    id: "c2",
    src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCMsc8hfp9Lbs2mI6x5b6hEh9SfxUE1TjjuHKTvHmydbuoH7vuAAqenojfX6oG5lugKEGg6KWZupfy7An0ESbZ6VHN0G_hhUmnwsFlaLZt4V1JQDCIUFuUusg3kdsU5P1dFKWqMM585mTZB-G-qtWMnrW15E4qOro9c287DDc-U3vH7CiO30if3qzRXY9a6UOGP2W8K-WujTatDlp1ivyAk8LCQagacw5lNQCpnrblMNr46SHLkeyf-g_8A06MZRol7ODgXJhkrGeQ",
    city: "Düsseldorf",
    time: "20:00",
    caption: "In der Galerie",
  },
  {
    id: "c3",
    src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCuu59PSEWUsK2k3Hywp03qrPdpdlxzVlyF0NtaVDa5FIxouDSRPHQY8tXBNu9yQhmVuqKrHmRq7azYU2_JJXa45Jjt5VESxpmHdZ5pQBUJ_BsHVlAmfwCh9ZuzeLkLdMHwDDJ2WG3Q_YkWUcmaHbWlYrKSvx1t987qzh1sBz9Bgo5vO_CEYoQETOTK9RCeyt8p3AXINmeM86s7n1QrJTCUT5wQ6THSzpaHhfS0708kZ8ttZVAfxzevERxsbUmxqHZR2TJVzCiJ2WM",
    city: "Düsseldorf",
    time: "20:00",
    caption: "An der Königsallee",
  },
  {
    id: "c4",
    src: PORTRAITS.davidArch,
    city: "Düsseldorf",
    time: "20:00",
    caption: "Auf der Brücke",
  },
  {
    id: "c5",
    src: PORTRAITS.leoWild,
    city: "Düsseldorf",
    time: "20:00",
    caption: "Am Rhein",
  },
];

/* ---- Swipe helpers ---- */
const SWIPE_THRESHOLD = 60;

function StoryPage() {
  const [index, setIndex] = useState(0);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const isLockedRef = useRef(false);

  const goNext = useCallback(() => {
    if (isLockedRef.current) return;
    setIndex((i) => {
      if (i >= CLIPS.length - 1) return i;
      isLockedRef.current = true;
      setTimeout(() => { isLockedRef.current = false; }, 500);
      return i + 1;
    });
  }, []);

  const goPrev = useCallback(() => {
    if (isLockedRef.current) return;
    setIndex((i) => {
      if (i <= 0) return i;
      isLockedRef.current = true;
      setTimeout(() => { isLockedRef.current = false; }, 500);
      return i - 1;
    });
  }, []);

  /* Touch swipe */
  useEffect(() => {
    let startX = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      tracking = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const diff = startX - e.changedTouches[0].clientX;
      if (diff > SWIPE_THRESHOLD) goNext();
      else if (diff < -SWIPE_THRESHOLD) goPrev();
    };
    window.addEventListener("touchstart", onStart);
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [goNext, goPrev]);

  /* Mouse / trackpad swipe */
  useEffect(() => {
    let startX = 0;
    let tracking = false;
    const onDown = (e: MouseEvent) => {
      startX = e.clientX;
      tracking = true;
    };
    const onUp = (e: MouseEvent) => {
      if (!tracking) return;
      tracking = false;
      const diff = startX - e.clientX;
      if (diff > SWIPE_THRESHOLD) goNext();
      else if (diff < -SWIPE_THRESHOLD) goPrev();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [goNext, goPrev]);

  const clip = CLIPS[index];

  const toggleFollow = useCallback(() => {
    setFollowed((prev) => {
      const next = new Set(prev);
      if (next.has(clip.id)) next.delete(clip.id);
      else next.add(clip.id);
      return next;
    });
  }, [clip.id]);

  const isFollowed = followed.has(clip.id);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      {/* Clips (horizontal stack) */}
      <div className="absolute inset-0 flex">
        {CLIPS.map((c, i) => {
          const offset = i - index;
          const isActive = offset === 0;
          const isNeighbor = Math.abs(offset) === 1;

          return (
            <div
              key={c.id}
              className="absolute inset-0 w-full h-full"
              style={{
                transform: `translateX(${offset * 100}%)`,
                opacity: isActive || isNeighbor ? 1 : 0,
                zIndex: isActive ? 10 : 5,
                transition: "transform 0.5s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.4s ease",
                willChange: "transform, opacity",
              }}
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
                    onClick={toggleFollow}
                    className={`shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                      isFollowed
                        ? "bg-white text-black"
                        : "bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {isFollowed ? "check" : "person_add"}
                    </span>
                    {isFollowed ? "Folgst du" : "Folgen"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress dots */}
      <div className="absolute top-6 right-6 z-30 flex gap-1.5">
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
