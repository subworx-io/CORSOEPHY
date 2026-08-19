import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { FollowButton } from "@/components/follow-button";
import { HeartBurst, useHeartBurst } from "@/components/heart-burst";
import { recordView } from "@/lib/record-view";
import { MomentMenu } from "@/components/moment-menu";

export const Route = createFileRoute("/story")({
  head: () => ({
    meta: [
      { title: "Stadt-Story — Corso" },
      { name: "description", content: "20:00 — Deine Stadt enthüllt sich." },
    ],
  }),
  component: StoryPage,
});

const CITY = (import.meta.env.VITE_PILOT_CITY as string | undefined) ?? "Düsseldorf";

// Corso-Tag clientseitig, spiegelt corso_day() der DB: der Tag läuft 08:00→08:00
// (Europe/Berlin). So liest der Client dieselbe eingefrorene Auswahl wie der Server.
function corsoDay(now = new Date()): string {
  const shifted = new Date(now.getTime() - 8 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted); // en-CA → YYYY-MM-DD
}

// Nächste 20:00 — Ziel des Countdowns, solange die Story noch nicht läuft.
// Rollt nach 20:00 automatisch auf den Folgetag weiter.
function nextStoryTarget(now: number): number {
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  if (now >= target.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

// Ende der laufenden Story: der Corso-Tag läuft 08:00→08:00, die stadtweite
// Auswahl ist bis zum nächsten 08:00 eingefroren. So lange „läuft" die Story.
function storyEndsAt(now: number): number {
  const target = new Date(now);
  target.setHours(8, 0, 0, 0);
  if (now >= target.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

// Tickt sekündlich und liefert die verbleibende Zeit bis zum Ziel.
function useTimeLeft(targetOf: (now: number) => number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const diff = Math.max(0, targetOf(now) - now);
  return {
    hours: Math.floor(diff / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    total: diff,
  };
}

const pad = (n: number) => n.toString().padStart(2, "0");

interface StoryClip {
  slot: number;
  handle: string;
  videoUrl: string;
  postId: string;
  authorId: string;
}

/* Video-Kachel — identische UX wie Discovery (autoplay stumm, tippen für Ton). */
function VideoTile({ src, isActive }: { src: string; isActive: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (isActive) v.play().catch(() => {});
    else v.pause();
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

function StoryPage() {
  const { user } = useAuth();

  // Die stadtweit eingefrorene Auswahl des heutigen Corso-Tags. Alle Nutzer der
  // Stadt lesen exakt dieselben Slots (serverseitig um 20:00 gezogen).
  const { data: clips = [], isLoading } = useQuery({
    queryKey: ["city-story", corsoDay(), CITY, user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("city_story_slots")
        .select("slot, posts(id, author_id, media_path, profiles(handle))")
        .eq("story_date", corsoDay())
        .eq("city", CITY)
        .order("slot", { ascending: true });
      if (error || !data?.length) return [];

      const withUrls = await Promise.all(
        data.map(async (row) => {
          const post = row.posts as unknown as {
            id: string;
            author_id: string;
            media_path: string;
            profiles: { handle: string };
          } | null;
          if (!post) return null;
          const { data: urlData } = await supabase.storage
            .from("moments")
            .createSignedUrl(post.media_path, 3600);
          if (!urlData?.signedUrl) return null;
          return {
            slot: row.slot as number,
            handle: post.profiles.handle,
            videoUrl: urlData.signedUrl,
            postId: post.id,
            authorId: post.author_id,
          } satisfies StoryClip;
        }),
      );
      return withUrls.filter((c): c is StoryClip => c !== null);
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { currentIndex, slideRef, containerRef } = useSnapScroll({
    count: clips.length,
    axis: "y",
  });
  const { burstHandle, triggerBurst } = useHeartBurst();

  // Ansicht verbuchen, sobald ein Story-Clip aktiv wird (Datenquelle „Zuschauer").
  // Kurze Verweil-Schwelle — siehe Begründung in index.tsx (Zuschauer = Kill-Metrik).
  useEffect(() => {
    const postId = clips[currentIndex]?.postId;
    if (!postId) return;
    const t = setTimeout(() => recordView(postId), 500);
    return () => clearTimeout(t);
  }, [currentIndex, clips]);

  // Noch keine Story (vor 20:00 oder heute kein einwilligender Clip): ehrlicher
  // Leerzustand statt Mock. Kein "peinlich leer" durch Fake-Auffüllen (PRD).
  if (!isLoading && clips.length === 0) {
    return <StoryEmpty />;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-dvh w-full overflow-hidden bg-neutral-950"
      style={{ touchAction: "none" }}
    >
      {clips.map((c, i) => {
        const offset = i - currentIndex;
        const isActive = offset === 0;
        const isNeighbor = Math.abs(offset) === 1;

        return (
          <div
            key={c.slot}
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
                <VideoTile src={c.videoUrl} isActive={isActive} />

                {/* Gradient-Ring-Overlay (identisch zur Discovery) */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-[2rem]"
                  style={{
                    background:
                      "linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.08) 100%)",
                    mixBlendMode: "overlay",
                  }}
                />

                {/* Melden/Blockieren — unaufdringlicher Overflow-Einstieg oben rechts */}
                <div className="absolute top-4 right-4 z-20">
                  <MomentMenu
                    reportedUserId={c.authorId}
                    reportedPostId={c.postId}
                    handle={c.handle}
                  />
                </div>

                {/* Herz-Burst beim Folgen — geteilt mit Discovery */}
                <HeartBurst active={burstHandle === c.handle} />

                {/* Bottom overlay — Ort/Zeit + Handle + Folgen.
                    🔒 KEINE Reaktions- oder Follower-Zahlen sichtbar (PRD §4.6). */}
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
                    <FollowButton handle={c.handle} src={null} onBurst={() => triggerBurst(c.handle)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Seitenindikatoren — identisch zur Discovery */}
      <div className="absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col gap-1.5">
        {clips.map((c, i) => (
          <div
            key={c.slot}
            className={`w-1.5 rounded-full transition-all duration-300 ${
              i === currentIndex ? "h-6 bg-white shadow-lg" : "h-1.5 bg-white/40"
            }`}
          />
        ))}
      </div>

      {/* Läuft-noch-Anzeige — die Story ist bis 08:00 stadtweit sichtbar. */}
      <StoryRunningBadge />

      <SwipeHint />
    </div>
  );
}

// Dezente Pille oben mittig: zeigt, wie lange die laufende Story noch sichtbar
// ist (bis zum 08:00-Reset des Corso-Tags). Keine Sekunden — es sind Stunden.
function StoryRunningBadge() {
  const { hours, minutes } = useTimeLeft(storyEndsAt);
  const label = hours > 0 ? `noch ${hours} h ${minutes} min` : `noch ${minutes} min`;

  return (
    <div
      className="absolute left-0 right-0 z-20 flex justify-center pointer-events-none"
      style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
    >
      <div className="flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-md px-3.5 py-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        <span className="text-white text-xs font-medium tracking-tight tabular-nums">
          Stadt-Story · {label}
        </span>
      </div>
    </div>
  );
}

// Leerzustand-Hintergrund: cross-fadende Düsseldorf-Clips, s/w, körnig, unscharf.
// Clips liegen in public/ (empty-bg-4…9.mp4), geladen per absolutem Pfad — so
// funktioniert es in Dev und im Cloudflare-Deploy identisch.
const EMPTY_CLIPS = [
  "/empty-bg-4.mp4",
  "/empty-bg-5.mp4",
  "/empty-bg-6.mp4",
  "/empty-bg-7.mp4",
  "/empty-bg-8.mp4",
  "/empty-bg-9.mp4",
];
const EMPTY_HOLD_MS = 1600;

function StoryEmpty() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    // Immer dieselbe Reihenfolge, endlos geloopt.
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % EMPTY_CLIPS.length);
    }, EMPTY_HOLD_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950 flex items-center justify-center px-8">
      {/* ── Hintergrund: cross-fadende Düsseldorf-Clips, s/w, körnig, unscharf ── */}
      <div className="absolute inset-0 overflow-hidden">
        {EMPTY_CLIPS.map((src, i) => (
          <EmptyBgVideo key={src} src={src} visible={i === active} />
        ))}

        {/* Dunkler Vignette-Scrim, damit Text lesbar bleibt */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 50%, rgba(5,5,10,0.35) 0%, rgba(5,5,10,0.75) 60%, rgba(5,5,10,0.95) 100%)",
          }}
        />
        {/* Blue-hour Tint */}
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-60"
          style={{
            background:
              "linear-gradient(180deg, rgba(20,30,60,0.35) 0%, rgba(0,0,0,0) 60%)",
          }}
        />
        {/* Grain — feines animiertes Rauschen via SVG. Div über den Rand hinaus
            (-inset), damit die Animation keinen sichtbaren Rahmen erzeugt. */}
        <div
          className="pointer-events-none absolute -inset-8 opacity-[0.22] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
            backgroundSize: "240px 240px",
            backgroundRepeat: "repeat",
            animation: "emptyGrain 1.2s steps(6) infinite",
          }}
        />
        <style>{`
          @keyframes emptyGrain {
            0%   { background-position: 0px 0px; }
            20%  { background-position: -40px 30px; }
            40%  { background-position: 30px -20px; }
            60%  { background-position: -20px -35px; }
            80%  { background-position: 35px 15px; }
            100% { background-position: 0px 0px; }
          }
        `}</style>
      </div>

      <div className="relative z-10 flex flex-col items-center text-center gap-6 text-white/70">
        <span className="material-symbols-outlined text-[40px] text-white/50">nights_stay</span>

        <div className="flex flex-col items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.4em] text-white/50 font-medium">
            Stadt-Story um 20:00
          </span>
          <StoryCountdown />
        </div>

        <p className="text-sm text-white/60 max-w-xs">
          Um 20:00 enthüllt sich {CITY}. Dann zeigt die ganze Stadt dieselben Momente von heute.
        </p>
      </div>
    </div>
  );
}

// Großer Countdown auf die nächste 20:00 — das Gegenstück zum kleinen „läuft
// noch"-Badge, solange die Story noch nicht begonnen hat.
function StoryCountdown() {
  const { hours, minutes, seconds } = useTimeLeft(nextStoryTarget);

  return (
    <div className="flex items-end gap-3 tabular-nums">
      {[
        { v: pad(hours), l: "Std" },
        { v: pad(minutes), l: "Min" },
        { v: pad(seconds), l: "Sek" },
      ].map((u, idx) => (
        <div key={u.l} className="flex items-end gap-3">
          <div className="flex flex-col items-center">
            <span className="text-5xl font-semibold tracking-tight text-white">{u.v}</span>
            <span className="text-[10px] uppercase tracking-[0.25em] text-white/40 mt-2 font-medium">
              {u.l}
            </span>
          </div>
          {idx < 2 && <span className="text-3xl font-semibold text-white/30 pb-6">:</span>}
        </div>
      ))}
    </div>
  );
}

function EmptyBgVideo({ src, visible }: { src: string; visible: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (visible) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }, [visible]);

  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-cover"
      style={{
        opacity: visible ? 1 : 0,
        transition: "none",
        filter: "grayscale(1) contrast(1.05) brightness(0.7) blur(5px)",
        transform: "scale(1.25)",
        transformOrigin: "center",
      }}
    />
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
