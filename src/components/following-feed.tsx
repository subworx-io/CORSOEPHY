import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFollow, followFill, canRenew, type FollowedPerson } from "@/lib/follow-context";
import { useCircle } from "@/lib/circle/use-circle";
import { useSnapScroll, SNAP_MS } from "@/hooks/use-snap-scroll";
import { useSwipeFollow, SWIPE_EXIT_MS } from "@/hooks/use-swipe-follow";
import { SwipeFollowOverlay } from "@/components/swipe-follow-overlay";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { recordView } from "@/lib/record-view";
import { MomentMenu } from "@/components/moment-menu";
import { fetchPromptsByDate } from "@/lib/prompts/prompt-history";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { MomentPrompt } from "@/components/moment-prompt";
import { PhotoStackTile } from "@/components/photo-stack";
import { VideoTile } from "@/components/video-tile";

// „Ich folge" (Achse 1, zweite Unteransicht des Stadt-Screens): Menschen, denen
// du folgst und die NICHT in deinem Circle sind.
//
// Sichtbarkeitsregel (Umbau 2. Sep 2026): Die VERBINDUNG (dein Follow, 24h ab
// (Re-)Follow) bleibt bestehen, sichtbar ist aber nur, wer gerade einen
// lebenden Moment hat. Wer nichts zeigt, ist vorübergehend unsichtbar und
// taucht mit dem nächsten Post wieder auf — kein Karteileichen-Feed.
// Konsequenz (bewusst, mit Dominik abgestimmt): Erneuern geht nur an sichtbaren
// Kacheln; wer nicht postet, dessen Follow läuft still aus.
// Anstupsen ist mit dem Umbau geparkt (Feature ohne Ort, DB bleibt bestehen).

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

// Einheitliche Pill-Optik (früher geteilt mit dem FollowButton — der ist seit
// dem Swipe-Follow weg, Folgen/Erneuern passiert per Rechts-Wisch).
const PILL =
  "flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-full transition-all active:scale-95";
const PILL_SOLID = "bg-white text-black";

// Lebender Moment einer gefolgten Person — Video oder Foto-Stapel + Prompt.
type FollowedMoment = {
  videoUrl?: string;
  photoUrls?: string[];
  postId: string;
  prompt: { text: string; date: string } | null;
};

function PersonSlide({
  person,
  now,
  moment,
  isActive,
  cardRef,
}: {
  person: FollowedPerson;
  now: number;
  moment: FollowedMoment;
  isActive: boolean;
  // Karten-Element für Swipe-Renew/-Unfollow (use-swipe-follow bewegt es direkt).
  cardRef: (el: HTMLElement | null) => void;
}) {
  const fill = followFill(person.followedAt, now);
  const renewable = canRenew(person.followedAt, now);

  return (
    <div
      className="absolute inset-0 px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 3.5rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
      }}
    >
      <div
        ref={cardRef}
        className="relative w-full h-full rounded-[2rem] overflow-hidden"
        style={{
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
        }}
      >
        {/* Melden/Blockieren — unaufdringlicher Overflow-Einstieg oben rechts */}
        {person.id && (
          <div className="absolute top-4 right-4 z-20">
            <MomentMenu
              reportedUserId={person.id}
              reportedPostId={moment.postId}
              handle={person.handle}
            />
          </div>
        )}

        {moment.photoUrls ? (
          <PhotoStackTile urls={moment.photoUrls} isActive={isActive} />
        ) : moment.videoUrl ? (
          <VideoTile src={moment.videoUrl} isActive={isActive} />
        ) : null}

        {/* Zu welchem Prompt ist dieser Moment entstanden? */}
        {moment.prompt && <MomentPrompt text={moment.prompt.text} date={moment.prompt.date} />}

        {/* Herz/gebrochenes Herz blenden mit dem Wisch-Fortschritt ein */}
        <SwipeFollowOverlay label="erneuern" />
        <SwipeFollowOverlay label="entfolgen" direction="left" />

        {/* Bottom overlay — Handle links, Status rechts. Alles läuft über Wischen:
            rechts = erneuern (ab 12 h), links = entfolgen (PRD 4.4 — Person
            taucht wieder in Discovery auf). Die Pille ist reiner Status. */}
        <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
          <div className="flex items-end justify-between gap-3">
            <span className="min-w-0 truncate text-white text-lg font-semibold tracking-tight drop-shadow-md">
              {person.handle}
            </span>

            <div className="flex flex-col items-end gap-1.5">
              <div className={`${PILL} ${PILL_SOLID} pointer-events-none`}>
                <GlassHeart fill={fill} className="text-[16px]" />
                folgst du heute
              </div>
              <span className="text-[11px] font-medium text-white/60 drop-shadow-md">
                {renewable ? "← entfolgen · erneuern →" : "← wischen zum Entfolgen"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FollowingFeed() {
  const { followed, renew, unfollow } = useFollow();
  const { partnerIds: circleIds } = useCircle();
  const { user } = useAuth();

  // Circle-Partner gehören zur Achse 2 — sie leben im Circle-Tab, nicht hier.
  const people = useMemo(
    () => Array.from(followed.values()).filter((p) => !(p.id && circleIds.has(p.id))),
    [followed, circleIds],
  );

  // Live-Ticker: lässt die Herzen über die Zeit sichtbar an Fülle verlieren
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const handles = people.map((p) => p.handle);

  // Holt den aktuellsten LEBENDEN Post (+ signierte URLs) für jede gefolgte Person.
  const { data: momentsByHandle = {}, isPending } = useQuery<Record<string, FollowedMoment>>({
    queryKey: ["following-posts", handles.join(",")],
    queryFn: async () => {
      if (!handles.length) return {};
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, handle")
        .in("handle", handles);
      if (!profiles?.length) return {};

      const authorIds = profiles.map((p) => p.id);
      // Nur lebende Momente (24h ab Post) — wer keinen hat, ist hier unsichtbar.
      const { data: posts } = await supabase
        .from("posts")
        .select("id, media_path, media_type, media_paths, author_id, prompt_date")
        .in("author_id", authorIds)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (!posts?.length) return {};

      // Pro Author nur der neueste lebende Post (Liste ist created_at desc sortiert).
      const newestByAuthor = new Map<string, (typeof posts)[number]>();
      for (const post of posts) {
        if (!newestByAuthor.has(post.author_id)) newestByAuthor.set(post.author_id, post);
      }
      const newest = Array.from(newestByAuthor.values());

      // Alle Medienpfade eines Posts (Video: einer, Foto-Moment: bis zu 5).
      const pathsOf = (post: {
        media_path: string;
        media_type: string;
        media_paths: string[] | null;
      }) =>
        post.media_type === "photo" && post.media_paths?.length
          ? post.media_paths
          : [post.media_path];

      // Prompt-Texte und signierte URLs je in EINER Abfrage, parallel. Die URLs sind
      // gecacht (signed-urls.ts) — ein Refetch tauscht das <video src> nicht aus.
      const [promptsByDate, urlsByPath] = await Promise.all([
        fetchPromptsByDate(newest.map((p) => p.prompt_date)),
        getSignedMomentUrls(newest.flatMap((p) => pathsOf(p))),
      ]);

      const result: Record<string, FollowedMoment> = {};
      for (const post of newest) {
        const profile = profiles.find((p) => p.id === post.author_id);
        const urls = pathsOf(post)
          .map((path) => urlsByPath[path])
          .filter((u): u is string => !!u);
        if (!profile || !urls.length) continue;
        const promptText = promptsByDate[post.prompt_date];
        result[profile.handle] = {
          videoUrl: post.media_type === "photo" ? undefined : urls[0],
          photoUrls: post.media_type === "photo" ? urls : undefined,
          postId: post.id,
          prompt: promptText ? { text: promptText, date: post.prompt_date } : null,
        };
      }
      return result;
    },
    enabled: !!user && handles.length > 0,
    staleTime: 0,
    refetchOnMount: true,
    // Der Handle-Satz steht IM Query-Key — jedes Entfolgen erzeugt also einen
    // neuen Key ohne Cache-Eintrag. Ohne das hier stünde `momentsByHandle` für
    // einen Wimpernschlag leer da, `visible` wäre leer und der Leerzustand
    // („Gerade zeigt niemand einen Moment") blitzte auf, obwohl sich nur eine
    // Person aus der Liste verabschiedet hat. Die alten Einträge bleiben für die
    // verbliebenen Handles gültig — sie zu behalten ist keine Notlüge.
    placeholderData: keepPreviousData,
  });

  // Sichtbar ist nur, wer gerade einen lebenden Moment hat (Umbau-Regel).
  const visible = people.filter((p) => momentsByHandle[p.handle]);

  // snapTo/realign für die Entfolgen-Choreografie (Hook läuft erst weiter unten).
  const snapRef = useRef<{ snapTo: (i: number) => void; realign: (i: number) => void } | null>(
    null,
  );

  // Rechts-Wisch = Follow erneuern (ab 12 h Follow-Alter, wie der frühere
  // Button; Karte federt zurück, das GlassHeart füllt sich wieder). Vorher
  // federt die Karte nur zäh zurück — die Regel bleibt serverseitig erzwungen
  // (0015-Trigger). Links-Wisch = entfolgen: Karte fliegt nach links raus, der
  // Feed scrollt zum nächsten Moment, dann erst räumt unfollow() die Person aus
  // dem Context (zu früh aufgerufen, verschwände die Kachel unterm Finger).
  const { cardRef, swipeHandlers } = useSwipeFollow({
    right: {
      canCommit: (i) => {
        const person = visible[i];
        return !!person && canRenew(person.followedAt, Date.now());
      },
      onCommit: (i) => {
        const person = visible[i];
        if (person) renew(person.handle);
      },
    },
    left: {
      canCommit: (i) => !!visible[i],
      onCommit: (i) => {
        const person = visible[i];
        if (!person) return;
        window.setTimeout(() => snapRef.current?.snapTo(i + 1), SWIPE_EXIT_MS);
        window.setTimeout(
          () => {
            unfollow(person.handle);
            snapRef.current?.realign(i);
          },
          SWIPE_EXIT_MS + SNAP_MS + 60,
        );
      },
      exitOnCommit: true,
    },
  });

  const { currentIndex, slideRef, containerRef, snapTo, realign } = useSnapScroll({
    count: visible.length,
    axis: "y",
    onSwipeX: swipeHandlers,
  });
  snapRef.current = { snapTo, realign };

  // Ansicht verbuchen, sobald der Moment einer gefolgten Person aktiv wird
  // (Follower-Ansichten zählen ebenfalls als „Zuschauer").
  // Kurze Verweil-Schwelle — siehe Begründung in discovery-feed (Kill-Metrik).
  const activeHandle = visible[currentIndex]?.handle;
  useEffect(() => {
    const postId = activeHandle ? momentsByHandle[activeHandle]?.postId : undefined;
    if (!postId) return;
    const t = setTimeout(() => recordView(postId), 500);
    return () => clearTimeout(t);
  }, [activeHandle, momentsByHandle]);

  // Erster Aufruf, Follows vorhanden, Momente noch unterwegs: „niemand zeigt
  // etwas" wäre eine Behauptung ohne Deckung. Lieber kurz nichts sagen.
  if (visible.length === 0 && people.length > 0 && isPending) {
    return <div className="absolute inset-0" />;
  }

  if (visible.length === 0) {
    const hasInvisible = people.length > 0;
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-20 h-20 rounded-full bg-white/8 border border-white/10 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-white/25 text-[36px]">
            {hasInvisible ? "nights_stay" : "explore"}
          </span>
        </div>
        {hasInvisible ? (
          <>
            <p className="text-white text-lg font-semibold tracking-tight">
              Gerade zeigt niemand einen Moment
            </p>
            <p className="mt-2 text-white/40 text-sm leading-snug max-w-[16rem]">
              Deine Follows bleiben bestehen — wer neu postet, taucht hier sofort wieder auf.
            </p>
          </>
        ) : (
          <>
            <p className="text-white text-lg font-semibold tracking-tight">Noch niemand</p>
            <p className="mt-2 text-white/40 text-sm leading-snug max-w-[15rem]">
              Folge Menschen in der Discovery — ihre Momente erscheinen dann hier.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0" style={{ touchAction: "none" }}>
      {visible.map((person, i) => {
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
            <PersonSlide
              person={person}
              now={now}
              moment={momentsByHandle[person.handle]}
              isActive={isActive}
              cardRef={cardRef(i)}
            />
          </div>
        );
      })}

      {/* Seitenindikatoren */}
      <div className="absolute top-1/2 right-3 z-20 -translate-y-1/2 flex flex-col gap-1.5">
        {visible.map((_, i) => (
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
