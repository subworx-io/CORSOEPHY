import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import skylineUrl from "@/assets/duesseldorf-skyline.jpg";
import { Link } from "@tanstack/react-router";
import { useFollow } from "@/lib/follow-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { FollowButton } from "@/components/follow-button";
import { HeartBurst, useHeartBurst } from "@/components/heart-burst";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

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

type Tile = { handle: string; src?: string; alt?: string; videoUrl?: string };
type CountdownSlide = { kind: "countdown" };
type TileSlide = { kind: "tile" } & Tile;
type EmptySlide = { kind: "empty" };
type Slide = CountdownSlide | TileSlide | EmptySlide;

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

function VideoTile({ src, isActive }: { src: string; isActive: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (isActive) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isActive]);

  function toggleMute() {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  return (
    <>
      <video
        ref={ref}
        src={src}
        playsInline
        muted
        loop
        className="absolute inset-0 h-full w-full object-cover"
      />
      {isActive && (
        <button
          onClick={toggleMute}
          className="absolute top-4 left-4 h-9 w-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform z-10"
          aria-label={muted ? "Ton einschalten" : "Ton ausschalten"}
        >
          <span className="material-symbols-outlined text-white text-[18px]">
            {muted ? "volume_off" : "volume_up"}
          </span>
        </button>
      )}
    </>
  );
}

const buildSlides = (tiles: Tile[]): Slide[] => [
  { kind: "countdown" },
  ...(tiles.length > 0
    ? tiles.map((t) => ({ kind: "tile" as const, ...t }))
    : [{ kind: "empty" as const }]),
];

// Dauer, die eine gerade gefolgte Kachel noch sichtbar bleibt: Herz-Burst (700ms) + Wegblenden.
const EXIT_MS = 1100;

function Index() {
  const { burstHandle, triggerBurst } = useHeartBurst();
  const { hours, minutes, seconds } = useCountdown();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Echte Posts aus der DB laden (andere User, neueste zuerst)
  const { data: dbTiles = [] } = useQuery({
    queryKey: ["discovery", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("posts")
        .select("id, media_path, profiles(handle)")
        .neq("author_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error || !data?.length) return [];
      const withUrls = await Promise.all(
        data.map(async (post) => {
          const { data: urlData } = await supabase.storage
            .from("moments")
            .createSignedUrl(post.media_path, 3600);
          return {
            handle: (post.profiles as unknown as { handle: string }).handle,
            videoUrl: urlData?.signedUrl ?? null,
          };
        }),
      );
      return withUrls.filter(
        (t): t is { handle: string; videoUrl: string } => t.videoUrl !== null,
      );
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Nur echte Posts aus der Stadt — kein Demo-Fallback mehr (F&F-Pilot: echt statt Fake).
  const activeTiles: Tile[] = dbTiles;

  // Discovery zeigt nur Fremde (PRD §4.4): wem du folgst, verlässt den Feed.
  // Reaktiv auf den Follow-State — nicht am Mount eingefroren, damit das Verhalten
  // überall gleich ist (kein "bleibt diese Session, weg nach Navigation"-Zufall mehr).
  const { followed, reset } = useFollow();
  // `exiting` hält eine gerade gefolgte Kachel kurz im Feed, damit sie sichtbar
  // rausgleiten kann, statt unter dem Finger zu verschwinden.
  const [exiting, setExiting] = useState<Set<string>>(() => new Set());

  const slides = useMemo(
    () => buildSlides(activeTiles.filter((t) => !followed.has(t.handle) || exiting.has(t.handle))),
    [activeTiles, followed, exiting]
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
            key={slide.kind === "tile" ? slide.handle : slide.kind}
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
                    {slide.videoUrl ? (
                      <VideoTile src={slide.videoUrl} isActive={isActive} />
                    ) : (
                      <img
                        src={slide.src}
                        alt={slide.alt ?? ""}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    )}
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
                        <FollowButton handle={slide.handle} src={slide.src ?? null} onBurst={() => handleFollowed(slide.handle)} />
                      </div>
                    </div>
                  </>
                ) : slide.kind === "countdown" ? (
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
                ) : (
                  // Kein echter Moment in der Stadt heute — ehrlicher Leerzustand statt Fake-Kacheln.
                  <div
                    className="w-full h-full flex flex-col items-center justify-center gap-5 px-8 text-center text-white relative"
                    style={{
                      background:
                        "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.05), transparent 65%), linear-gradient(160deg, #141414 0%, #080808 100%)",
                    }}
                  >
                    <div className="w-20 h-20 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-white/30 text-[36px]">group</span>
                    </div>
                    <div>
                      <p className="text-white text-lg font-semibold tracking-tight">Heute war noch niemand draußen</p>
                      <p className="mt-2 text-white/40 text-sm leading-snug max-w-[16rem] mx-auto">
                        Sei die erste Person in der Stadt — nimm deinen Moment auf.
                      </p>
                    </div>
                    <Link
                      to="/record"
                      className="mt-1 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black active:scale-[0.99] transition-transform"
                    >
                      <span className="material-symbols-outlined text-[18px]">videocam</span>
                      Moment aufnehmen
                    </Link>
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
          {/* Dev/Test: simuliert den 08:00-Reset — setzt eigene DB-Follows auf abgelaufen */}
          <button
            onClick={() => void supabase.rpc("dev_expire_my_follows").then(() => {
              reset();
              void queryClient.invalidateQueries({ queryKey: ["connections-posts"] });
            })}
            className="flex items-center text-white/70 hover:text-white active:scale-95 transition-all drop-shadow-md"
            aria-label="08:00-Reset simulieren"
            title="08:00-Reset simulieren (Dev)"
          >
            <span className="material-symbols-outlined">alarm</span>
          </button>
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
