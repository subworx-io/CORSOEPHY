import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useFollow, followFill, canRenew, type FollowedPerson } from "@/lib/follow-context";
import { useCircle } from "@/lib/circle/use-circle";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { mediaWindow } from "@/lib/feed-media-window";
import { useSwipeFollow, SWIPE_EXIT_MS } from "@/hooks/use-swipe-follow";
import { SwipeFollowOverlay } from "@/components/swipe-follow-overlay";
import { supabase } from "@/lib/supabase/client";
import { isControlTap, tapDirection } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { recordView } from "@/lib/record-view";
import { MomentMenu } from "@/components/moment-menu";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { SequenceMedia } from "@/components/sequence-media";
import { MomentProgress } from "@/components/moment-progress";
import { FeedStatus } from "@/components/feed-status";
import {
  useMomentSequence,
  firstStepOf,
  type SequenceMoment,
  type SequenceGroup,
  type SequenceStep,
} from "@/hooks/use-moment-sequence";

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
// Stabile leere Liste — eine frische [] pro Render würde die Sequenz zurücksetzen.
const EMPTY_MOMENTS: SequenceMoment[] = [];
const NO_MOMENTS_BY_HANDLE: Record<string, FollowedMoments> = {};

// Alle lebenden Momente einer gefolgten Person, als Sequenz zum In-Place-Blättern.
type FollowedMoments = SequenceMoment[];

function PersonSlide({
  person,
  now,
  moments,
  isActive,
  cardRef,
  step,
  currentMoment,
  groups,
  stepIndex,
  hasSequence,
  isLastStep,
  onEnded,
  mountMedia,
  preload,
  warm,
}: {
  person: FollowedPerson;
  now: number;
  moments: FollowedMoments;
  isActive: boolean;
  // Karten-Element für Swipe-Renew/-Unfollow (use-swipe-follow bewegt es direkt).
  cardRef: (el: HTMLElement | null) => void;
  // Sequenz-Zustand — nur die aktive Kachel bekommt ihn; Nachbarn zeigen ihren
  // Anfang (siehe firstStepOf).
  step?: SequenceStep;
  currentMoment?: SequenceMoment;
  groups: SequenceGroup[];
  stepIndex: number;
  hasSequence: boolean;
  isLastStep: boolean;
  onEnded: () => void;
  // Video-Fenster: außerhalb bleibt nur die Kachel-Hülle stehen.
  mountMedia: boolean;
  preload: "auto" | "metadata";
  warm: boolean;
}) {
  const shown = isActive ? { step, moment: currentMoment } : firstStepOf(moments);
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
              reportedPostId={shown.step?.postId ?? moments[0]?.postId ?? null}
              handle={person.handle}
            />
          </div>
        )}

        {mountMedia && shown.step && (
          <SequenceMedia
            step={shown.step}
            moment={shown.moment}
            isActive={isActive}
            isLastStep={isActive ? isLastStep : false}
            onEnded={onEnded}
            preload={preload}
            warm={warm}
          />
        )}

        {/* Fortschritt der Sequenz — eine Zeile oben, sofort sichtbar. */}
        {isActive && hasSequence && (
          <div className="pointer-events-none absolute inset-x-4 top-3 z-20">
            <MomentProgress groups={groups} stepIndex={stepIndex} />
          </div>
        )}

        {/* Herz/gebrochenes Herz blenden mit dem Wisch-Fortschritt ein */}
        <SwipeFollowOverlay label="erneuern" />
        <SwipeFollowOverlay label="entfolgen" direction="left" />

        {/* Bottom overlay — Handle links, Status rechts. Alles läuft über Wischen:
            rechts = erneuern (ab 12 h), links = entfolgen (PRD 4.4 — Person
            taucht wieder in Discovery auf). Die Pille ist reiner Status. */}
        <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
          <div className="flex items-end justify-between gap-3">
            {/* Reiner Text — kein Einstieg in eine Zwischenebene mehr (9. Sep 2026). */}
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
  const navigate = useNavigate();
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
  const {
    data: momentsData,
    isPlaceholderData,
    isError,
    isFetching,
    refetch,
  } = useQuery<Record<string, FollowedMoments>>({
    queryKey: ["following-posts", handles.join(",")],
    queryFn: async () => {
      if (!handles.length) return {};
      // Fehler WERFEN statt als „niemand zeigt etwas" durchzugehen — sonst
      // stand nach einem Funkloch der Leerzustand da, obwohl nur das Netz fehlte.
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, handle")
        .in("handle", handles);
      if (profilesError) throw profilesError;
      if (!profiles?.length) return {};

      const authorIds = profiles.map((p) => p.id);
      // Nur lebende Momente (24h ab Post) — wer keinen hat, ist hier unsichtbar.
      const { data: posts, error: postsError } = await supabase
        .from("posts")
        .select("id, media_path, media_type, media_paths, author_id")
        .in("author_id", authorIds)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (postsError) throw postsError;
      if (!posts?.length) return {};

      // Alle Medienpfade eines Posts (Video: einer, Foto-Moment: bis zu 5).
      const pathsOf = (post: {
        media_path: string;
        media_type: string;
        media_paths: string[] | null;
      }) =>
        post.media_type === "photo" && post.media_paths?.length
          ? post.media_paths
          : [post.media_path];

      // Signierte URLs in EINER Abfrage. Sie sind gecacht (signed-urls.ts) —
      // ein Refetch tauscht das <video src> nicht aus.
      const urlsByPath = await getSignedMomentUrls(posts.flatMap((p) => pathsOf(p)));

      // ALLE lebenden Momente je Person als Sequenz. Die Query liefert
      // created_at DESC; innerhalb einer Person wird umgedreht, damit man
      // chronologisch vorwärts durch ihren Tag blättert.
      const result: Record<string, FollowedMoments> = {};
      for (const post of posts) {
        const profile = profiles.find((p) => p.id === post.author_id);
        const urls = pathsOf(post)
          .map((path) => urlsByPath[path])
          .filter((u): u is string => !!u);
        if (!profile || !urls.length) continue;
        const isPhoto = post.media_type === "photo";
        const moment: SequenceMoment = {
          postId: post.id,
          authorId: post.author_id,
          videoUrl: isPhoto ? null : urls[0],
          photoUrls: isPhoto ? urls : null,
        };
        (result[profile.handle] ??= []).unshift(moment);
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
  const momentsByHandle = momentsData ?? NO_MOMENTS_BY_HANDLE;
  // Gibt es für DIESEN Handle-Satz schon eine echte Antwort? Platzhalter (der
  // Stand vor einem Entfolgen) zählt nicht — er darf nur ein Aufblitzen des
  // Leerzustands verhindern, aber keinen behaupten.
  const hasAnswer = momentsData !== undefined && !isPlaceholderData;

  // Sichtbar ist nur, wer gerade einen lebenden Moment hat (Umbau-Regel).
  const visible = people.filter((p) => momentsByHandle[p.handle]?.length);

  // snapTo für die Entfolgen-Choreografie (Hook läuft erst weiter unten).
  const snapRef = useRef<((i: number, onSettled?: () => void) => void) | null>(null);

  // Rechts-Wisch = Follow erneuern (ab 12 h Follow-Alter, wie der frühere
  // Button; Karte federt zurück, das GlassHeart füllt sich wieder). Vorher
  // federt die Karte nur zäh zurück — die Regel bleibt serverseitig erzwungen
  // (0015-Trigger). Links-Wisch = entfolgen: Karte fliegt nach links raus, der
  // Feed scrollt zum nächsten Moment, und erst wenn der Scroll steht, räumt
  // unfollow() die Person aus dem Context (zu früh aufgerufen, verschwände die
  // Kachel unterm Finger). Die Dauer des nativen Scrolls ist nicht
  // vorhersagbar, deshalb hängt das am Ende der Bewegung statt an einem Timer.
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
        window.setTimeout(
          () => snapRef.current?.(i + 1, () => unfollow(person.handle)),
          SWIPE_EXIT_MS,
        );
      },
      exitOnCommit: true,
    },
  });

  const { currentIndex, settledIndex, direction, slideRef, containerRef, shieldRef, snapTo } =
    useSnapScroll({
      count: visible.length,
      onSwipeX: swipeHandlers,
      // Tipp = ein Schritt weiter in der Sequenz, linkes Drittel = zurück.
      // Siehe TapInfo in use-snap-scroll.ts.
      onTap: ({ index, x, y, rect, target }) => {
        if (isControlTap(target)) return;
        if (index !== currentIndexRef.current) return;
        if (tapDirection(x, y, rect) === "prev") seqRef.current?.prev();
        else seqRef.current?.next();
      },
    });
  snapRef.current = snapTo;

  // Sequenz der aktiven Person (eine pro Feed — Nachbarn zeigen ihren Anfang).
  const activePerson = visible[currentIndex];
  const seq = useMomentSequence({
    moments: (activePerson && momentsByHandle[activePerson.handle]) || EMPTY_MOMENTS,
    isActive: true,
    onExhausted: () => snapTo(Math.min(visible.length - 1, currentIndex + 1)),
  });
  const seqRef = useRef(seq);
  seqRef.current = seq;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  // Ansicht verbuchen, sobald der Moment einer gefolgten Person aktiv wird
  // (Follower-Ansichten zählen ebenfalls als „Zuschauer").
  // Kurze Verweil-Schwelle — siehe Begründung in discovery-feed (Kill-Metrik).
  // Verbucht wird der Moment, auf dem die Sequenz gerade steht.
  const activePostId = seq.step?.postId;
  useEffect(() => {
    if (!activePostId) return;
    const t = setTimeout(() => recordView(activePostId), 500);
    return () => clearTimeout(t);
  }, [activePostId]);

  // Follows vorhanden, aber noch keine Antwort (unterwegs oder gescheitert):
  // „niemand zeigt etwas" wäre eine Behauptung ohne Deckung. Wie in allen
  // Zweigen hier fehlen Scroller und Shield dann gemeinsam.
  if (visible.length === 0 && people.length > 0 && !hasAnswer) {
    return (
      <FeedStatus
        state={isError && !isFetching ? "error" : "pending"}
        onRetry={() => void refetch()}
      />
    );
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
    <div className="absolute inset-0">
      <div ref={containerRef} className="snap-feed">
        {visible.map((person, i) => {
          const isActive = i === currentIndex;
          // Medien-Fenster: Regel in lib/feed-media-window.ts. Vorher montierte
          // dieser Feed für JEDE gefolgte Person gleichzeitig ein <video>.
          const media = mediaWindow(i, currentIndex, settledIndex, direction);

          return (
            <div key={person.handle} ref={slideRef(i)} className="snap-feed-slide">
              <PersonSlide
                person={person}
                now={now}
                moments={momentsByHandle[person.handle] ?? EMPTY_MOMENTS}
                isActive={isActive}
                cardRef={cardRef(i)}
                step={seq.step}
                currentMoment={seq.currentMoment}
                groups={seq.groups}
                stepIndex={seq.stepIndex}
                hasSequence={seq.hasSequence}
                isLastStep={seq.isLastStep}
                onEnded={seq.autoNext}
                mountMedia={media.mount}
                preload={media.preload}
                warm={media.warm}
              />
            </div>
          );
        })}
      </div>
      {/* Fängt Berührungen ab, solange der Feed nachläuft (use-snap-scroll). */}
      <div ref={shieldRef} className="snap-feed-shield" aria-hidden />

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
