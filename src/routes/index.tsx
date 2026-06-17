import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PORTRAITS } from "@/assets/portraits";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Korso — deine Stadt heute Abend" },
      { name: "description", content: "Jeden Abend geht deine Stadt gemeinsam spazieren. Echte Momente, echte Menschen." },
      { property: "og:title", content: "Korso — deine Stadt heute Abend" },
      { property: "og:description", content: "Jeden Abend geht deine Stadt gemeinsam spazieren." },
    ],
  }),
  component: Index,
});

type Tile = { handle: string; src: string; alt: string };
type CountdownSlide = { kind: "countdown" };
type TileSlide = { kind: "tile" } & Tile;
type Slide = CountdownSlide | TileSlide;

const COUNTDOWN_TARGET = new Date("2026-07-01T00:00:00").getTime();

function useCountdown(target: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds };
}

const pad = (n: number) => n.toString().padStart(2, "0");

const TILES: Tile[] = [
  { handle: "@elias_v", src: PORTRAITS.eliasFashion, alt: "High-fashion editorial portrait in a concrete studio." },
  { handle: "@marah.k", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCMsc8hfp9Lbs2mI6x5b6hEh9SfxUE1TjjuHKTvHmydbuoH7vuAAqenojfX6oG5lugKEGg6KWZupfy7An0ESbZ6VHN0G_hhUmnwsFlaLZt4V1JQDCIUFuUusg3kdsU5P1dFKWqMM585mTZB-G-qtWMnrW15E4qOro9c287DDc-U3vH7CiO30if3qzRXY9a6UOGP2W8K-WujTatDlp1ivyAk8LCQagacw5lNQCpnrblMNr46SHLkeyf-g_8A06MZRol7ODgXJhkrGeQ", alt: "Artist in a bright white-walled gallery." },
  { handle: "@jannis_lux", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCuu59PSEWUsK2k3Hywp03qrPdpdlxzVlyF0NtaVDa5FIxouDSRPHQY8tXBNu9yQhmVuqKrHmRq7azYU2_JJXa45Jjt5VESxpmHdZ5pQBUJ_BsHVlAmfwCh9ZuzeLkLdMHwDDJ2WG3Q_YkWUcmaHbWlYrKSvx1t987qzh1sBz9Bgo5vO_CEYoQETOTK9RCeyt8p3AXINmeM86s7n1QrJTCUT5wQ6THSzpaHhfS0708kZ8ttZVAfxzevERxsbUmxqHZR2TJVzCiJ2WM", alt: "Designer at a glowing monitor in a dark workspace." },
  { handle: "@clara_mondo", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCNAGoqfZYjD0KGwJ5NyYi0NPETnyhYBJKWL-KIu01CeJxxUTXERz5QQKlco40pWoCbIPCbqb8Z40YEqy9KeC5KGaZbV4OQvCHnyMYpUkOqhb_xDx44OBCGn5HRifDnj2BpxrRb6qTmi5xgRG4bOU8jCrwtP_vliEQZOHNA2n6HUgnYz6QN5DbTg18FZNRLIm-c2YpVROf77tbL4q11x6G0mFf3EQIo7uFZfNhlmEJHi7RBhj-Q66qsegy-0G_yjdV0RqRWc2_KdhI", alt: "Portrait against a white architectural wall." },
  { handle: "@lukas.berlin", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuAPcJaaO61LZuueix4hrVPy7HIpLRzj6uvsrz4OCNOVv6BagJwwqSZobRp-Vax-IAmF0rC_nWE1rY4Pyg5B83__bFXsS7hzequ1Cu1Wo4LizHH8VLGVqbwGa2pvbBSa6MhDnmzo1KEwpAJzBfmgIO4DVcysq9gWUQi0cqGWPgCD4P6VyX4BRHlkbnPuLV2sGlN-3iTiD1mNDsLrDC1RPCOgLVNJf3An3KsDPzDCJpNgEy_9Rdq4Op2GNPa0jfjzo3fFz4itzZU348I", alt: "Creative professional in a high-contrast urban scene." },
  { handle: "@sara_sound", src: PORTRAITS.saraSound, alt: "Close-up editorial portrait with braids and feathered collar." },
  { handle: "@david_arch", src: PORTRAITS.davidArch, alt: "Monochrome street portrait with sunglasses." },
  { handle: "@nina.pure", src: PORTRAITS.ninaPure, alt: "Editorial portrait grid of a young man in studio light." },
  { handle: "@leo.wild", src: PORTRAITS.leoWild, alt: "Atmospheric sepia-toned portrait in a foggy field." },
];

const SLIDES: Slide[] = [
  { kind: "countdown" },
  ...TILES.map((t) => ({ kind: "tile" as const, ...t })),
];

function Index() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const isLockedRef = useRef(false);
  const { days, hours, minutes, seconds } = useCountdown(COUNTDOWN_TARGET);

  const goNext = useCallback(() => {
    if (isLockedRef.current) return;
    setCurrentIndex((i) => {
      if (i >= SLIDES.length - 1) return i;
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

  useEffect(() => {
    let accumulated = 0;
    const threshold = 80;
    let resetId: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isLockedRef.current) {
        accumulated = 0;
        return;
      }
      accumulated += e.deltaY;
      if (resetId) clearTimeout(resetId);
      resetId = setTimeout(() => { accumulated = 0; }, 150);
      if (accumulated > threshold) {
        goNext();
        accumulated = 0;
      } else if (accumulated < -threshold) {
        goPrev();
        accumulated = 0;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (resetId) clearTimeout(resetId);
    };
  }, [goNext, goPrev]);

  useEffect(() => {
    let startY = 0;
    let tracking = false;
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      tracking = true;
    };
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
      {/* Slides */}
      {SLIDES.map((slide, i) => {
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
              transition: "transform 0.7s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.5s ease",
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
                    {/* Bottom overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                      <div className="flex justify-between items-end">
                        <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
                          {slide.handle}
                        </span>
                        <button className="bg-white/95 backdrop-blur-sm text-black px-4 py-1.5 text-sm font-semibold rounded-full hover:bg-white transition-colors active:scale-95">
                          Ansehen
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div
                    className="w-full h-full flex flex-col items-center justify-center text-white relative"
                    style={{
                      background:
                        "radial-gradient(circle at 30% 20=20%, rgba(255,255,255,0.08), transparent 60%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.04), transparent 55%), linear-gradient(160deg, #111 0%, #050505 100%)",
                    }}
                  >
                    <div className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6 font-medium">
                      Korso — heute Abend in
                    </div>
                    <div className="flex items-end gap-3 tabular-nums">
                      {[
                        { v: pad(days), l: "Tage" },
                        { v: pad(hours), l: "Std" },
                        { v: pad(minutes), l: "Min" },
                        { v: pad(seconds), l: "Sek" },
                      ].map((u, idx) => (
                        <div key={u.l} className="flex items-end gap-3">
                          <div className="flex flex-col items-center">
                            <span className="text-5xl font-semibold tracking-tight">{u.v}</span>
                            <span className="text-[10px] uppercase tracking-[0.25em] text-white/40 mt-2 font-medium">{u.l}</span>
                          </div>
                          {idx < 3 && <span className="text-3xl font-semibold text-white/30 pb-6">:</span>}
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

      {/* Top bar */}
      <header className="absolute top-0 left-0 right-0 z-20">
        <div className="flex justify-end items-center px-6 h-14 max-w-[600px] mx-auto">
          <button className="flex items-center gap-2 text-white active:scale-95 transition-transform drop-shadow-md" aria-label="Einstellungen">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>

      {/* Page indicators */}
      <div className="absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col gap-1.5">
        {SLIDES.map((_, i) => (
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
