import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useFollow,
  followFill,
  canRenew,
  lastReset,
  type FollowedPerson,
} from "@/lib/follow-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "ich folge — Corso" },
      { name: "description", content: "Menschen denen du folgst." },
    ],
  }),
  component: ConnectionsPage,
});

/**
 * Herz, das wie ein Glas von unten nach oben vollläuft (0..1) — visualisiert den
 * täglichen Verfall. Umriss = leeres Glas, gefülltes Herz wird per clip-path von
 * unten eingeblendet (steigender Flüssigkeitspegel statt Füllung von innen).
 */
function GlassHeart({ fill, className = "" }: { fill: number; className?: string }) {
  const hiddenTop = ((1 - Math.max(0, Math.min(1, fill))) * 100).toFixed(1);
  return (
    <span className={`relative inline-block leading-none ${className}`}>
      {/* leeres Glas (Kontur) */}
      <span
        className="material-symbols-outlined leading-none block opacity-25"
        style={{ fontVariationSettings: "'FILL' 0" }}
      >
        favorite
      </span>
      {/* Füllung — nur der untere `fill`-Anteil ist sichtbar */}
      <span
        className="material-symbols-outlined leading-none block absolute inset-0"
        style={{ fontVariationSettings: "'FILL' 1", clipPath: `inset(${hiddenTop}% 0 0 0)` }}
      >
        favorite
      </span>
    </span>
  );
}

// Einheitliche Pill-Optik wie der FollowButton in Discovery/Story.
const PILL = "flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-full transition-all active:scale-95";
const PILL_OUTLINE = "bg-white/15 backdrop-blur-sm text-white border border-white/30 hover:bg-white/25";
const PILL_SOLID = "bg-white text-black";

function PersonSlide({
  person,
  now,
  videoUrl,
  isActive,
}: {
  person: FollowedPerson;
  now: number;
  videoUrl?: string;
  isActive: boolean;
}) {
  const { renew, unfollow, nudge } = useFollow();
  const fill = followFill(person.followedAt, now);
  const renewable = canRenew(person.followedAt, now);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isActive) v.play().catch(() => {});
    else v.pause();
  }, [isActive]);

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  // „Moment heute?" hängt am echten heutigen Video (videoUrl wird nur für Posts seit dem
  // letzten 08:00-Reset geladen), nicht mehr am Demo-Portrait — sonst wäre der Anstups-/
  // Leerzustand nie erreichbar.
  const hasMomentToday = !!videoUrl;

  return (
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
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
        }}
      >
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              playsInline
              muted
              loop
              className="absolute inset-0 h-full w-full object-cover"
            />
            {isActive && (
              <button
                onClick={toggleMute}
                className="absolute top-4 left-4 h-9 w-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform z-10"
              >
                <span className="material-symbols-outlined text-white text-[18px]">
                  {muted ? "volume_off" : "volume_up"}
                </span>
              </button>
            )}
          </>
        ) : person.src ? (
          <>
            <img
              src={person.src}
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

        {/* Bottom overlay — Handle links, Aktions-Pills rechts (Layout wie Discovery/Story) */}
        <div className={`absolute bottom-0 left-0 right-0 p-5 ${hasMomentToday ? "bg-gradient-to-t from-black/80 via-black/30 to-transparent" : ""}`}>
          <div className="flex items-end justify-between gap-3">
            <span className="min-w-0 truncate text-white text-lg font-semibold tracking-tight drop-shadow-md">
              {person.handle}
            </span>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Anstupsen nur, wenn heute noch kein Video vorhanden (PRD 4.5) */}
              {!hasMomentToday && (
                <button
                  onClick={() => nudge(person.handle)}
                  disabled={person.nudged}
                  className={`${PILL} ${person.nudged ? "bg-white/10 text-white/40" : PILL_OUTLINE}`}
                >
                  <span className="material-symbols-outlined text-[16px] leading-none">notification_add</span>
                  {person.nudged ? "angestupst" : "anstupsen"}
                </button>
              )}

              {/* Erneuern, sobald der Follow vor dem heutigen Reset lag — sonst Status „folgst du heute" */}
              {renewable ? (
                <button onClick={() => renew(person.handle)} className={`${PILL} ${PILL_OUTLINE}`}>
                  <GlassHeart fill={fill} className="text-[16px]" />
                  follow erneuern
                </button>
              ) : (
                // Tippen beendet den Follow → Person verlässt „Ich folge" und
                // taucht wieder in Discovery auf (PRD 4.4).
                <button onClick={() => unfollow(person.handle)} className={`${PILL} ${PILL_SOLID} group`}>
                  <GlassHeart fill={fill} className="text-[16px] group-active:hidden" />
                  <span className="material-symbols-outlined text-[16px] leading-none hidden group-active:inline">
                    heart_broken
                  </span>
                  <span className="group-active:hidden">folgst du heute</span>
                  <span className="hidden group-active:inline">entfolgen</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionsPage() {
  const { followed } = useFollow();
  const { user } = useAuth();
  const people = Array.from(followed.values());
  const { currentIndex, slideRef } = useSnapScroll({ count: people.length, axis: "y" });

  // Live-Ticker: lässt die Herzen über die Zeit sichtbar an Fülle verlieren
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const handles = people.map((p) => p.handle);

  // Holt den aktuellsten Post (+ signierte Video-URL) für jede gefolgte Person
  const { data: videosByHandle = {} } = useQuery({
    queryKey: ["connections-posts", handles.join(",")],
    queryFn: async () => {
      if (!handles.length) return {};
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, handle")
        .in("handle", handles);
      if (!profiles?.length) return {};

      const authorIds = profiles.map((p) => p.id);
      // Nur der heutige Moment zählt (seit dem letzten 08:00-Reset) — sonst würde ein alter
      // Clip als „Moment heute" durchgehen und den Anstups-Zustand fälschlich unterdrücken.
      const sinceReset = new Date(lastReset(Date.now())).toISOString();
      const { data: posts } = await supabase
        .from("posts")
        .select("media_path, author_id")
        .in("author_id", authorIds)
        .gte("created_at", sinceReset)
        .order("created_at", { ascending: false });
      if (!posts?.length) return {};

      // Eine signierte URL pro Author (neuester Post)
      const result: Record<string, string> = {};
      const seen = new Set<string>();
      for (const post of posts) {
        if (seen.has(post.author_id)) continue;
        seen.add(post.author_id);
        const profile = profiles.find((p) => p.id === post.author_id);
        if (!profile) continue;
        const { data: urlData } = await supabase.storage
          .from("moments")
          .createSignedUrl(post.media_path, 3600);
        if (urlData?.signedUrl) result[profile.handle] = urlData.signedUrl;
      }
      return result;
    },
    enabled: !!user && handles.length > 0,
    staleTime: 0,
    refetchOnMount: true,
  });

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
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950" style={{ touchAction: "none" }}>
      {people.map((person, i) => {
        const offset = i - currentIndex;
        const isActive = offset === 0;
        const isNeighbor = Math.abs(offset) === 1;

        return (
          <div
            key={person.handle}
            ref={slideRef(i)}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: isActive ? 10 : isNeighbor ? 5 : 0 }}
          >
            <PersonSlide person={person} now={now} videoUrl={videosByHandle[person.handle]} isActive={isActive} />
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
