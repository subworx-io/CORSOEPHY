import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useFollow } from "@/lib/follow-context";
import { useCircle } from "@/lib/circle/use-circle";
import { useSnapScroll, SNAP_MS } from "@/hooks/use-snap-scroll";
import { useSwipeFollow, SWIPE_EXIT_MS } from "@/hooks/use-swipe-follow";
import { SwipeFollowOverlay, SwipeHintChip } from "@/components/swipe-follow-overlay";
import { useHeartBurst } from "@/components/heart-burst";
import { supabase } from "@/lib/supabase/client";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { useAuth } from "@/lib/auth-context";
import { recordView } from "@/lib/record-view";
import { MomentMenu } from "@/components/moment-menu";
import { fetchPromptsByDate } from "@/lib/prompts/prompt-history";
import { MomentPrompt } from "@/components/moment-prompt";
import { PhotoStackTile } from "@/components/photo-stack";
import { VideoTile } from "@/components/video-tile";

// Discovery (Achse 1, Feed „komplett neue, fremde Menschen"): lebender 24h-Topf
// der Stadt, neueste zuerst, Infinite Scroll. Seit dem Zwei-Achsen-Umbau eine
// Unteransicht des Stadt-Screens (index.tsx) — hierher extrahiert, damit der
// Screen nur noch Toggle + Kopf trägt.
//
// Wer rausfliegt: eigene Momente, Leute denen du folgst (→ „Ich folge"-Feed)
// und Circle-Partner (→ Circle-Tab, Achse 2).

type Tile = {
  handle: string;
  src?: string;
  alt?: string;
  videoUrl?: string;
  // Foto-Moment (0023): geordnete Foto-URLs — gesetzt statt videoUrl.
  photoUrls?: string[];
  postId?: string;
  authorId?: string;
  // Der Prompt, zu dem dieser Moment entstanden ist. Der Feed reicht über die
  // Zyklus-Grenze (21:00) hinaus — ein Moment lebt 24h ab Post, die Kacheln
  // gehören also zu zwei Prompts. null = keine Historie für den Tag → nichts zeigen.
  promptText?: string | null;
  promptDate?: string | null;
};
type TileSlide = { kind: "tile" } & Tile;
type EmptySlide = { kind: "empty" };
type Slide = TileSlide | EmptySlide;

const buildSlides = (tiles: Tile[]): Slide[] =>
  tiles.length > 0
    ? tiles.map((t) => ({ kind: "tile" as const, ...t }))
    : [{ kind: "empty" as const }];

// Momente pro Nachlade-Schritt (Posts + Prompts + signierte URLs = 3 Requests pro Seite).
const PAGE_SIZE = 20;
// So viele Kacheln vor dem Ende wird nachgeladen, damit nie eine Lücke entsteht.
const PREFETCH_MARGIN = 3;
// Nur der aktive Moment ± VIDEO_WINDOW bekommt ein <video>-Element. Vorher luden
// alle 20+ Kacheln einer Seite gleichzeitig — der Clip, den man gerade ansieht,
// konkurrierte mit 19 anderen um die Leitung, und iOS drosselt viele Media-
// Elemente ohnehin. Zwei Slides Vorlauf reichen, eine Wischgeste bewegt ~eine.
const VIDEO_WINDOW = 2;
// Solange bleibt der Feed nach einem Screen-/App-Wechsel ohne Neuladen stehen.
// Ein Refetch sortiert neue Momente oben ein — mitten im Wischen rutscht dann die
// Kachel unter dem Finger weiter. Nach einer Minute darf das passieren, nach einem
// kurzen Blick in „Ich folge" nicht.
const FEED_STALE_MS = 60_000;

export function DiscoveryFeed() {
  const { burstHandle, triggerBurst } = useHeartBurst();
  const { user } = useAuth();

  // Echte Posts aus der DB laden: nur LEBENDE Momente (jeder Moment lebt 24h ab
  // seinem Post), neueste zuerst, seitenweise nachgeladen. Kein hartes Limit mehr —
  // der Feed scrollt endlos durch den lebenden Topf.
  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["discovery", user?.id],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!user) return [] as Tile[];
      const from = (pageParam as number) * PAGE_SIZE;
      const { data, error } = await supabase
        .from("posts")
        .select("id, author_id, media_path, media_type, media_paths, prompt_date, profiles(handle)")
        .neq("author_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data?.length) return [] as Tile[];
      // Alle Medienpfade eines Posts (Video: einer, Foto-Moment: bis zu 5).
      const pathsOf = (post: {
        media_path: string;
        media_type: string;
        media_paths: string[] | null;
      }) =>
        post.media_type === "photo" && post.media_paths?.length
          ? post.media_paths
          : [post.media_path];
      // Prompt-Texte und signierte URLs je in EINER Abfrage, parallel. Die URLs
      // kommen aus dem Cache (signed-urls.ts): ein Refetch liefert dieselben URLs
      // wie zuvor, die <video>-Elemente laden also nicht neu.
      const [promptsByDate, urlsByPath] = await Promise.all([
        fetchPromptsByDate(data.map((p) => p.prompt_date)),
        getSignedMomentUrls(data.flatMap((p) => pathsOf(p))),
      ]);
      return data.flatMap((post): Tile[] => {
        const urls = pathsOf(post)
          .map((path) => urlsByPath[path])
          .filter((u): u is string => !!u);
        if (!urls.length) return [];
        const isPhoto = post.media_type === "photo";
        return [
          {
            handle: (post.profiles as unknown as { handle: string }).handle,
            videoUrl: isPhoto ? undefined : urls[0],
            photoUrls: isPhoto ? urls : undefined,
            postId: post.id,
            authorId: post.author_id,
            promptDate: post.prompt_date,
            promptText: promptsByDate[post.prompt_date] ?? null,
          },
        ];
      });
    },
    // Volle Seite → es könnte noch mehr geben. Kürzere Seite → Ende des Topfes.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!user,
    // Mount und Fokus holen weiterhin nach (Defaults), aber erst wenn der Stand
    // älter als FEED_STALE_MS ist — nicht bei jedem kurzen Tab-Wechsel.
    staleTime: FEED_STALE_MS,
  });

  // Nur echte Posts aus der Stadt — kein Demo-Fallback mehr (F&F-Pilot: echt statt Fake).
  const activeTiles: Tile[] = useMemo(() => (pages?.pages ?? []).flat(), [pages]);

  // Discovery zeigt nur Fremde (PRD §4.4): wem du folgst, verlässt den Feed —
  // und Circle-Partner gehören zur Achse 2, nicht in die Stadt.
  // Reaktiv auf den Follow-State — nicht am Mount eingefroren, damit das Verhalten
  // überall gleich ist (kein "bleibt diese Session, weg nach Navigation"-Zufall mehr).
  const { followed, follow } = useFollow();
  const { partnerIds: circleIds } = useCircle();
  // `exiting` hält eine gerade gefolgte Kachel kurz im Feed, damit sie sichtbar
  // rausgleiten kann, statt unter dem Finger zu verschwinden.
  const [exiting, setExiting] = useState<Set<string>>(() => new Set());

  const slides = useMemo(
    () =>
      buildSlides(
        activeTiles.filter(
          (t) =>
            (!followed.has(t.handle) || exiting.has(t.handle)) &&
            !(t.authorId && circleIds.has(t.authorId)),
        ),
      ),
    [activeTiles, followed, exiting, circleIds],
  );

  // snapTo/realign aus useSnapScroll werden in der Commit-Choreografie unten
  // gebraucht, der Hook läuft aber erst danach → über ein Ref entkoppelt.
  const snapRef = useRef<{ snapTo: (i: number) => void; realign: (i: number) => void } | null>(
    null,
  );

  // Nach dem Swipe-Follow in drei Schritten weiter (gewünschtes Verhalten:
  // „Kachel verschwindet und ich scrolle automatisch zum nächsten Moment"):
  //   1. Karte fliegt nach rechts raus (macht use-swipe-follow, SWIPE_EXIT_MS).
  //   2. Der Feed scrollt animiert zum nächsten Moment (snapTo).
  //   3. Die gefolgte Kachel wird aus der Liste genommen und der Index im selben
  //      Tick unsichtbar nachgezogen (realign) — gleicher Frame, kein Sprung.
  const handleFollowed = (handle: string, index: number) => {
    triggerBurst(handle);
    setExiting((prev) => new Set(prev).add(handle));
    window.setTimeout(() => snapRef.current?.snapTo(index + 1), SWIPE_EXIT_MS);
    window.setTimeout(
      () => {
        setExiting((prev) => {
          const next = new Set(prev);
          next.delete(handle);
          return next;
        });
        snapRef.current?.realign(index);
      },
      SWIPE_EXIT_MS + SNAP_MS + 60,
    );
  };

  // Swipe-Follow: Rechts-Wisch auf der Kachel = Folgen (kein Button mehr).
  // Links gibt es in Discovery nichts zu entfolgen → Gummiband.
  const { cardRef, swipeHandlers } = useSwipeFollow({
    right: {
      canCommit: (i) => {
        const s = slides[i];
        return s?.kind === "tile" && !followed.has(s.handle);
      },
      onCommit: (i) => {
        const s = slides[i];
        if (s?.kind !== "tile") return;
        follow({ handle: s.handle, src: s.src ?? null });
        handleFollowed(s.handle, i);
      },
      exitOnCommit: true,
    },
  });

  const { currentIndex, slideRef, containerRef, snapTo, realign } = useSnapScroll({
    count: slides.length,
    axis: "y",
    onSwipeX: swipeHandlers,
  });
  snapRef.current = { snapTo, realign };

  // Endlos-Scroll: rechtzeitig vor dem Ende die nächste Seite holen, damit der
  // Feed unter dem Finger weiterläuft statt an einer Kante zu stehen.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    if (currentIndex >= slides.length - PREFETCH_MARGIN) void fetchNextPage();
  }, [currentIndex, slides.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Ansicht verbuchen, sobald ein fremder Clip aktiv wird (Datenquelle „Zuschauer").
  // Kurze Verweil-Schwelle: der aktive Index wechselt jetzt schon beim Überqueren
  // der Hälfte (damit das Video sofort spielt). Ohne die Schwelle würde jeder Clip,
  // an dem man nur vorbeizieht, als Zuschauer zählen — die Zahl ist Kill-Metrik.
  useEffect(() => {
    const active = slides[currentIndex];
    if (active?.kind !== "tile") return;
    const t = setTimeout(() => recordView(active.postId), 500);
    return () => clearTimeout(t);
  }, [currentIndex, slides]);

  return (
    <div ref={containerRef} className="absolute inset-0" style={{ touchAction: "none" }}>
      {/* Slides */}
      {slides.map((slide, i) => {
        const offset = i - currentIndex;
        const distance = Math.abs(offset);
        const isActive = offset === 0;
        const isNeighbor = distance === 1;
        const isExiting = slide.kind === "tile" && exiting.has(slide.handle);
        // Video-Fenster: außerhalb bleibt die Slide-Hülle stehen (der Snap-Hook
        // positioniert sie weiter), nur das <video> darin wird nicht gemountet.
        const mountVideo = distance <= VIDEO_WINDOW;
        const preload = distance <= 1 ? "auto" : "metadata";

        return (
          <div
            // Key = Post, nicht Handle: bleibt über Refetches stabil und kollidiert
            // nicht, falls eine Person über die Zyklus-Grenze zwei Momente hat.
            key={slide.kind === "tile" ? (slide.postId ?? slide.handle) : slide.kind}
            ref={slideRef(i)}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: isActive ? 10 : isNeighbor ? 5 : 0 }}
          >
            <div
              className="absolute inset-0 px-4"
              style={{
                paddingTop: "calc(env(safe-area-inset-top) + 3.5rem)",
                paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
                // Wegblenden erst nach dem Herz-Burst (Delay 600ms), dann sanft schrumpfen.
                opacity: isExiting ? 0 : 1,
                transform: isExiting ? "scale(0.9)" : "scale(1)",
                transition: "opacity 450ms ease 600ms, transform 450ms ease 600ms",
              }}
            >
              <div
                ref={cardRef(i)}
                className="relative w-full h-full rounded-[2rem] overflow-hidden"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
                }}
              >
                {slide.kind === "tile" ? (
                  <>
                    {slide.photoUrls ? (
                      mountVideo && <PhotoStackTile urls={slide.photoUrls} isActive={isActive} />
                    ) : slide.videoUrl ? (
                      mountVideo && (
                        <VideoTile src={slide.videoUrl} isActive={isActive} preload={preload} />
                      )
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
                    {/* Melden/Blockieren — unaufdringlicher Overflow-Einstieg oben rechts */}
                    {slide.authorId && (
                      <div className="absolute top-4 right-4 z-20">
                        <MomentMenu
                          reportedUserId={slide.authorId}
                          reportedPostId={slide.postId ?? null}
                          handle={slide.handle}
                        />
                      </div>
                    )}
                    {/* Zu welchem Prompt ist dieser Moment entstanden? */}
                    {slide.promptText && (
                      <MomentPrompt text={slide.promptText} date={slide.promptDate} />
                    )}
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
                    {/* Herz blendet mit dem Wisch-Fortschritt ein */}
                    <SwipeFollowOverlay label="folgen" />
                    {/* Bottom overlay — Folgen passiert per Rechts-Wisch, kein Button */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                      <div className="flex justify-between items-end">
                        <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
                          {slide.handle}
                        </span>
                        <SwipeHintChip label="wischen zum Folgen" />
                      </div>
                    </div>
                  </>
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
                      <span className="material-symbols-outlined text-white/30 text-[36px]">
                        group
                      </span>
                    </div>
                    <div>
                      <p className="text-white text-lg font-semibold tracking-tight">
                        Du bist früh dran
                      </p>
                      <p className="mt-2 text-white/40 text-sm leading-snug max-w-[16rem] mx-auto">
                        Noch ist niemand draußen. Nimm jetzt deinen Moment auf — oder warte, bis um
                        21 Uhr die Stadt gemeinsam spazieren geht.
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
    </div>
  );
}
