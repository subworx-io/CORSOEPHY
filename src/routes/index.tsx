import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useFollow } from "@/lib/follow-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { FollowButton } from "@/components/follow-button";
import { HeartBurst, useHeartBurst } from "@/components/heart-burst";
import { supabase } from "@/lib/supabase/client";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { useAuth } from "@/lib/auth-context";
import { recordView } from "@/lib/record-view";
import { useCityMomentCounts } from "@/lib/city/use-city-moment-counts";
import { MomentMenu } from "@/components/moment-menu";
import { fetchPromptsByDate } from "@/lib/prompts/prompt-history";
import { MomentPrompt } from "@/components/moment-prompt";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Corso — deine Stadt heute Abend" },
      {
        name: "description",
        content: "Jeden Abend geht deine Stadt gemeinsam spazieren. Echte Momente, echte Menschen.",
      },
      { property: "og:title", content: "Corso — deine Stadt heute Abend" },
      { property: "og:description", content: "Jeden Abend geht deine Stadt gemeinsam spazieren." },
    ],
  }),
  component: Index,
});

type Tile = {
  handle: string;
  src?: string;
  alt?: string;
  videoUrl?: string;
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

// Ab wann der Lade-Ring erscheint: kurze Puffer beim normalen Wischen sollen nicht
// aufblitzen, nur echtes Warten soll als solches sichtbar sein.
const STALL_INDICATOR_MS = 300;

function VideoTile({
  src,
  isActive,
  preload,
}: {
  src: string;
  isActive: boolean;
  // "auto" für den aktiven Moment und seine direkten Nachbarn (Bild liegt bereit,
  // wenn man hinzieht), "metadata" für den Rand des Fensters.
  preload: "auto" | "metadata";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  // Hat das Element gerade ein Bild (readyState ≥ HAVE_CURRENT_DATA)? Fällt bei
  // `waiting`/`emptied` zurück auf false.
  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);

  // `src` gehört bewusst in die Abhängigkeiten: ein src-Wechsel setzt das Element
  // zurück und PAUSIERT es (Media-Load-Algorithmus). Ohne erneutes play() bliebe der
  // aktive Moment nach einem Refetch als Standbild stehen.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (isActive) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isActive, src]);

  // Anfangszustand aus dem Element lesen — bei einem Cache-Treffer ist das Bild
  // schon da, bevor der erste Event-Handler hängt.
  useEffect(() => {
    const v = ref.current;
    if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setReady(true);
  }, []);

  useEffect(() => {
    if (!isActive || ready) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), STALL_INDICATOR_MS);
    return () => clearTimeout(t);
  }, [isActive, ready]);

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
        preload={preload}
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onPlaying={() => setReady(true)}
        onWaiting={() => setReady(false)}
        onEmptied={() => setReady(false)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Dezenter Lade-Ring — nur wenn der aktive Moment wirklich auf Daten wartet */}
      {stalled && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="h-9 w-9 rounded-full border-2 border-white/15 border-t-white/80 animate-spin" />
        </div>
      )}
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

// Discovery startet direkt beim ersten Moment — der 21:00-Countdown lebt jetzt
// auf dem Story-Screen (dort gehört er hin: er zählt auf den Stadt Corso).
const buildSlides = (tiles: Tile[]): Slide[] =>
  tiles.length > 0
    ? tiles.map((t) => ({ kind: "tile" as const, ...t }))
    : [{ kind: "empty" as const }];

// Dauer, die eine gerade gefolgte Kachel noch sichtbar bleibt: Herz-Burst (700ms) + Wegblenden.
const EXIT_MS = 1100;

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

function Index() {
  const { burstHandle, triggerBurst } = useHeartBurst();
  const { user } = useAuth();

  // Dezenter Gemeinschafts-Zähler: wachsendes Stimmungsbild der Stadt (Momente heute/gestern).
  const { data: cityCounts } = useCityMomentCounts();

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
        .select("id, author_id, media_path, prompt_date, profiles(handle)")
        .neq("author_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data?.length) return [] as Tile[];
      // Prompt-Texte für alle vorkommenden Tage in EINER Abfrage nachladen.
      // Prompt-Texte und signierte URLs je in EINER Abfrage, parallel. Die URLs
      // kommen aus dem Cache (signed-urls.ts): ein Refetch liefert dieselben URLs
      // wie zuvor, die <video>-Elemente laden also nicht neu.
      const [promptsByDate, urlsByPath] = await Promise.all([
        fetchPromptsByDate(data.map((p) => p.prompt_date)),
        getSignedMomentUrls(data.map((p) => p.media_path)),
      ]);
      return data.flatMap((post): Tile[] => {
        const videoUrl = urlsByPath[post.media_path];
        if (!videoUrl) return [];
        return [
          {
            handle: (post.profiles as unknown as { handle: string }).handle,
            videoUrl,
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

  // Discovery zeigt nur Fremde (PRD §4.4): wem du folgst, verlässt den Feed.
  // Reaktiv auf den Follow-State — nicht am Mount eingefroren, damit das Verhalten
  // überall gleich ist (kein "bleibt diese Session, weg nach Navigation"-Zufall mehr).
  const { followed } = useFollow();
  // `exiting` hält eine gerade gefolgte Kachel kurz im Feed, damit sie sichtbar
  // rausgleiten kann, statt unter dem Finger zu verschwinden.
  const [exiting, setExiting] = useState<Set<string>>(() => new Set());

  const slides = useMemo(
    () => buildSlides(activeTiles.filter((t) => !followed.has(t.handle) || exiting.has(t.handle))),
    [activeTiles, followed, exiting],
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

  const { currentIndex, slideRef, containerRef } = useSnapScroll({
    count: slides.length,
    axis: "y",
  });

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
    <div
      ref={containerRef}
      className="relative h-dvh w-full overflow-hidden bg-neutral-950"
      style={{ touchAction: "none" }}
    >
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
                    {/* Bottom overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                      <div className="flex justify-between items-end">
                        <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
                          {slide.handle}
                        </span>
                        <FollowButton
                          handle={slide.handle}
                          src={slide.src ?? null}
                          onBurst={() => handleFollowed(slide.handle)}
                        />
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

      {/* Top bar — safe-area-inset-top verhindert Konflikt mit Notch/Dynamic Island */}
      <header
        className="absolute top-0 left-0 right-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex justify-between items-start gap-4 px-6 pt-3 min-h-14 max-w-[600px] mx-auto">
          {/* Gemeinschafts-Zähler — dezentes Stimmungsbild, fängt keine Swipe-Gesten ab */}
          {cityCounts ? (
            <div className="pointer-events-none select-none drop-shadow-md leading-tight">
              <p className="text-white/80 text-sm font-semibold tracking-tight">
                {cityCounts.today} {cityCounts.today === 1 ? "Moment" : "Momente"} heute in
                Düsseldorf
              </p>
              <p className="text-white/40 text-xs mt-0.5">gestern: {cityCounts.yesterday}</p>
            </div>
          ) : (
            <span />
          )}
          <Link
            to="/settings"
            className="flex items-center gap-2 text-white active:scale-95 transition-transform drop-shadow-md"
            aria-label="Einstellungen"
          >
            <span className="material-symbols-outlined">settings</span>
          </Link>
        </div>
      </header>
    </div>
  );
}
