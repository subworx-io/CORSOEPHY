import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { isControlTap, tapDirection } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { useSwipeFollow } from "@/hooks/use-swipe-follow";
import { useFollow } from "@/lib/follow-context";
import { useCircle } from "@/lib/circle/use-circle";
import { SwipeFollowOverlay, SwipeHintChip } from "@/components/swipe-follow-overlay";
import { HeartBurst, useHeartBurst } from "@/components/heart-burst";
import { recordView } from "@/lib/record-view";
import { logEvent } from "@/lib/events";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { MomentMenu } from "@/components/moment-menu";
import { SequenceMedia } from "@/components/sequence-media";
import { MomentProgress } from "@/components/moment-progress";
import { useMomentSequence, firstStepOf, type SequenceMoment } from "@/hooks/use-moment-sequence";

export const Route = createFileRoute("/story")({
  head: () => ({
    meta: [
      { title: "Stadt Corso" },
      { name: "description", content: "Wer gerade auf der Bühne deiner Stadt steht." },
    ],
  }),
  component: StoryPage,
});

const CITY = (import.meta.env.VITE_PILOT_CITY as string | undefined) ?? "Düsseldorf";

// Der LAUFENDE Corso (Umbau 9. Sep 2026, Migration 0031).
//
// Es gibt keine Ziehung um 21:00 mehr und keinen Reset. Der Corso hat feste
// Slots; jede Belegung endet exakt dann, wenn ihr Moment 24 h alt wird, und ein
// Cron-Lauf (jede Minute) rückt den nächsten passenden Moment nach. Der Screen
// zeigt deshalb schlicht den aktuellen Stand — kein Countdown, kein Vorhang,
// keine Enthüllung zu einer festen Uhrzeit.
//
// Gelesen wird über corso_now() (SECURITY DEFINER): Block-Filter und die
// Lebend-Prüfung liegen serverseitig. Die Lebend-Prüfung dort schließt auch das
// Lag-Fenster von bis zu 60 s zwischen dem Ablauf eines Moments und dem
// nächsten Cron-Lauf — ein toter Moment ist sofort weg, nicht erst nach dem Tick.

// Wie oft der Screen nachfragt, ob jemand nachgerückt ist. Der Corso verändert
// sich jetzt jederzeit, nicht mehr einmal am Abend — aber auch nicht hektisch:
// pro frei werdendem Slot ein Wechsel.
const CORSO_POLL_MS = 30_000;
// Stabile leere Liste — eine frische [] pro Render würde die Sequenz zurücksetzen.
const EMPTY_MOMENTS: SequenceMoment[] = [];

// Rückgabezeile von corso_now() — 🔒 nur Anzeige-Daten, keine Zahlen.
interface CorsoRow {
  slot: number;
  handle: string;
  media_path: string;
  media_type?: string | null;
  media_paths?: string[] | null;
  post_id: string;
  author_id: string;
  entered_at: string;
}

interface StoryClip {
  slot: number;
  handle: string;
  authorId: string;
  /** Der Moment, der den Slot belegt — Startpunkt der Sequenz. */
  slotPostId: string;
  /** 🔒 AUSSCHLIESSLICH Momente mit Corso-Freigabe. */
  moments: SequenceMoment[];
  /** Position des Slot-Moments innerhalb von `moments`. */
  slotIndex: number;
}

function StoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // story_viewed (Metrik-Tracking): einmal beim Öffnen des Story-Screens, wenn
  // eingeloggt. Bewusst getrennt von app_open — das Öffnen der Stadt Corso ist
  // ein eigenes Signal (kann parallel zu app_open auftreten, wird getrennt
  // ausgewertet). Fire-and-forget; ein Log-Fehler stört die Story nicht.
  useEffect(() => {
    if (!user) return;
    logEvent("story_viewed");
  }, [user]);

  // Der aktuelle Stand des laufenden Corso. Alle Nutzer der Stadt sehen
  // dieselben Slots — die Besetzung liegt serverseitig in corso_slots, nicht in
  // einer Ziehung pro Client.
  const { data: clips = [], isLoading } = useQuery({
    queryKey: ["corso-now", CITY, user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.rpc("corso_now", { target_city: CITY });
      const rows = (data ?? []) as CorsoRow[];
      if (error || !rows.length) return [];

      // Alle Medienpfade eines Slots (Video: einer, Foto-Moment: bis zu 5).
      // Bewusst auf das Minimum getypt: dieselbe Funktion bedient die Slot-Zeilen
      // aus corso_now() UND die Zusatz-Momente aus der posts-Abfrage.
      const pathsOf = (row: {
        media_path: string;
        media_type?: string | null;
        media_paths?: string[] | null;
      }) =>
        row.media_type === "photo" && row.media_paths?.length ? row.media_paths : [row.media_path];

      // 🔒 In-Place-Blättern im Corso läuft AUSSCHLIESSLICH über Momente MIT
      // Corso-Freigabe (Entscheidung Dominik, 9. Sep 2026, Variante b). Ein
      // Moment ohne `city_story_consent` darf hier unter keinen Umständen
      // auftauchen — sonst hebelte das Blättern die Einwilligungs-Leitplanke aus.
      // Der Filter steht deshalb hart in der Query, nicht in der Darstellung.
      const authorIds = [...new Set(rows.map((r) => r.author_id))];
      const { data: consented } = await supabase
        .from("posts")
        .select("id, author_id, media_path, media_type, media_paths, created_at")
        .in("author_id", authorIds)
        .eq("city_story_consent", true) // 🔒 die Leitplanke
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true });

      const extra = consented ?? [];
      const allPaths = [
        ...rows.flatMap((row) => pathsOf(row)),
        ...extra.flatMap((p) => pathsOf(p)),
      ];
      const urlsByPath = await getSignedMomentUrls(allPaths);

      // Minimal getypt, damit dieselbe Funktion beide Quellen bedient (Supabase
      // liefert die Zusatz-Momente als `any`-ish, der Slot-Moment ist CorsoRow).
      const toMoment = (p: {
        id: string;
        author_id: string;
        media_path: string;
        media_type?: string | null;
        media_paths?: string[] | null;
        created_at?: string | null;
      }): SequenceMoment | null => {
        const urls = pathsOf(p)
          .map((path) => urlsByPath[path])
          .filter((u): u is string => !!u);
        if (!urls.length) return null;
        const isPhoto = p.media_type === "photo";
        return {
          postId: p.id,
          authorId: p.author_id,
          videoUrl: isPhoto ? null : urls[0],
          photoUrls: isPhoto ? urls : null,
          createdAt: p.created_at ?? null,
        };
      };

      return rows.flatMap((row): StoryClip[] => {
        const own = extra.filter((p) => p.author_id === row.author_id);
        // Der Moment, der den Slot belegt, MUSS in der Sequenz stecken — sonst
        // zeigte die Bühne jemand anderen als den, der wirklich draufsteht.
        // Fällt die Zusatz-Abfrage aus oder fehlt der Slot-Moment darin (z.B.
        // weil seine Freigabe nachträglich zurückgenommen wurde), wird er
        // ergänzt. Er steht ja bereits öffentlich auf der Bühne.
        const hasSlotMoment = own.some((p) => p.id === row.post_id);
        const source =
          own.length && hasSlotMoment
            ? own
            : [
                { ...row, id: row.post_id, created_at: undefined },
                ...own.filter((p) => p.id !== row.post_id),
              ];
        const moments = source.map(toMoment).filter((m): m is SequenceMoment => m !== null);
        if (!moments.length) return [];
        // Startpunkt ist der Moment, der wirklich auf der Bühne steht — nicht
        // zwangsläufig der älteste der Person.
        const slotIndex = Math.max(
          0,
          moments.findIndex((m) => m.postId === row.post_id),
        );
        return [
          {
            slot: row.slot,
            handle: row.handle,
            authorId: row.author_id,
            slotPostId: row.post_id,
            moments,
            slotIndex,
          },
        ];
      });
    },
    enabled: !!user,
    staleTime: CORSO_POLL_MS,
    refetchOnWindowFocus: true,
    // Der Corso besetzt laufend nach — regelmäßig nachfragen, statt auf ein
    // Ereignis zu einer festen Uhrzeit zu warten.
    refetchInterval: CORSO_POLL_MS,
  });

  const { burstHandle, triggerBurst } = useHeartBurst();
  const { isFollowing, follow, unfollow } = useFollow();
  // Circle-Partner sind Achse 2: Ihnen zu folgen hat keine Wirkung, weil sie im
  // „Ich folge"-Feed bewusst nicht auftauchen (PRD §4.4). Statt eines
  // folgenlosen Wischs zeigt die Kachel eine Status-Pille „in deinem Circle".
  const { partnerIds: circleIds } = useCircle();

  // Swipe-Follow: Rechts-Wisch auf dem Clip = Folgen, Links-Wisch = Entfolgen
  // (kein Button mehr). Der Clip bleibt in der Story stehen (die Ziehung ist
  // eingefroren), die Karte federt nach dem Commit zurück — den Zustand zeigt
  // die Status-Pille unten rechts.
  const { cardRef, swipeHandlers } = useSwipeFollow({
    right: {
      canCommit: (i) => {
        const c = clips[i];
        return !!c && !circleIds.has(c.authorId) && !isFollowing(c.handle);
      },
      onCommit: (i) => {
        const c = clips[i];
        if (!c) return;
        follow({ handle: c.handle, src: null });
        triggerBurst(c.handle);
      },
    },
    left: {
      canCommit: (i) => {
        const c = clips[i];
        return !!c && !circleIds.has(c.authorId) && isFollowing(c.handle);
      },
      onCommit: (i) => {
        const c = clips[i];
        if (c) unfollow(c.handle);
      },
    },
  });

  const { currentIndex, slideRef, containerRef, snapTo } = useSnapScroll({
    count: clips.length,
    axis: "y",
    onSwipeX: swipeHandlers,
    // Tipp = ein Schritt weiter in der Sequenz, linkes Drittel = zurück.
    // 🔒 Die Sequenz enthält nur freigegebene Momente (Filter in der Query).
    onTap: ({ index, x, y, target }) => {
      if (isControlTap(target)) return;
      if (index !== currentIndexRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (tapDirection(x, y, rect) === "prev") seqRef.current?.prev();
      else seqRef.current?.next();
    },
  });

  // Sequenz des aktiven Slots. Startpunkt ist der Moment auf der Bühne.
  const activeClip = clips[currentIndex];
  const seq = useMomentSequence({
    moments: activeClip?.moments ?? EMPTY_MOMENTS,
    isActive: true,
    initialMomentIndex: activeClip?.slotIndex ?? 0,
    onExhausted: () => snapTo(Math.min(clips.length - 1, currentIndex + 1)),
  });
  const seqRef = useRef(seq);
  seqRef.current = seq;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  // Ansicht verbuchen, sobald ein Story-Clip aktiv wird (Datenquelle „Zuschauer").
  // Kurze Verweil-Schwelle — siehe Begründung in index.tsx (Zuschauer = Kill-Metrik).
  const activePostId = seq.step?.postId;
  useEffect(() => {
    if (!activePostId) return;
    const t = setTimeout(() => recordView(activePostId), 500);
    return () => clearTimeout(t);
  }, [activePostId]);

  // Kein einwilligender Moment in der Stadt: ehrlicher Leerzustand statt Mock.
  // Kein „peinlich leer" durch Fake-Auffüllen (PRD §4.6).
  const showEmpty = !isLoading && clips.length === 0;

  // Enthüllungs-Animation: Rückt jemand nach, während man zuschaut, tritt der
  // Moment auf, statt einfach da zu sein. Erkannt am Übergang leer → besetzt.
  const wasEmptyRef = useRef(showEmpty);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (wasEmptyRef.current && !showEmpty && clips.length > 0) {
      setReveal(true);
      const t = setTimeout(() => setReveal(false), 1200);
      wasEmptyRef.current = false;
      return () => clearTimeout(t);
    }
    wasEmptyRef.current = showEmpty;
  }, [showEmpty, clips.length]);

  if (showEmpty) {
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
        // Steht der gerade gezeigte Schritt auf dem Moment, der den Slot belegt?
        // Nicht-aktive Kacheln zeigen ihren Anfang — dort gilt der Slot-Moment
        // nur, wenn er zufällig der erste ist.
        const shownPostId = isActive ? seq.step?.postId : c.moments[0]?.postId;
        const isSlotMoment = shownPostId === c.slotPostId;

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
                ref={cardRef(i)}
                className="relative w-full h-full rounded-[2rem] overflow-hidden"
                style={{
                  // Der Moment, der WIRKLICH einen Corso-Platz belegt, bekommt
                  // einen weißen Rand plus einen weichen Schein. Beim Blättern
                  // durch die anderen freigegebenen Momente derselben Person
                  // erlischt er — daran erkennt man auf einen Blick, welcher
                  // gerade auf der Bühne steht (Entscheidung Dominik, 9. Sep 2026).
                  // Bewusst nur Licht statt Farbe: der Screen kennt keine
                  // Akzentfarbe, und Weiß ist hier ohnehin die Sprache.
                  boxShadow: isSlotMoment
                    ? "0 0 0 2px rgba(255,255,255,0.92), 0 0 28px -6px rgba(255,255,255,0.45), 0 30px 80px -20px rgba(0,0,0,0.6)"
                    : "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
                  transition: "box-shadow 320ms ease",
                  // Die Ziehung tritt auf, statt nur da zu sein (nur der Moment im Blick).
                  animation:
                    reveal && isActive
                      ? "storyReveal 900ms cubic-bezier(0.22, 1, 0.36, 1) both"
                      : undefined,
                }}
              >
                {(() => {
                  const shown = isActive
                    ? { step: seq.step, moment: seq.currentMoment }
                    : firstStepOf(c.moments);
                  if (!shown.step) return null;
                  return (
                    <SequenceMedia
                      step={shown.step}
                      moment={shown.moment}
                      isActive={isActive}
                      isLastStep={isActive ? seq.isLastStep : false}
                      onEnded={seq.autoNext}
                    />
                  );
                })()}

                {/* Fortschritt der Sequenz — eine Zeile oben. Liegt über der
                    „Stadt Corso · läuft"-Pille, deshalb etwas tiefer. */}
                {isActive && seq.hasSequence && (
                  <div className="pointer-events-none absolute inset-x-4 top-3 z-20">
                    <MomentProgress groups={seq.groups} stepIndex={seq.stepIndex} />
                  </div>
                )}

                {/* Glanzkante, identisch zur Discovery — dort steht die
                    ausführliche Begründung, warum hier kein mix-blend-mode mehr
                    steht: Der Blend-Modus kostet auf einer bewegten Kachel
                    jeden Frame eine Neuberechnung des Untergrunds. */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-[2rem]"
                  style={{
                    background:
                      "linear-gradient(160deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.06) 100%)",
                  }}
                />

                {/* Melden/Blockieren — unaufdringlicher Overflow-Einstieg oben rechts */}
                <div className="absolute top-4 right-4 z-20">
                  <MomentMenu
                    reportedUserId={c.authorId}
                    reportedPostId={(isActive ? seq.step?.postId : c.slotPostId) ?? c.slotPostId}
                    handle={c.handle}
                  />
                </div>
                {/* Herz-Burst beim Folgen — geteilt mit Discovery */}
                <HeartBurst active={burstHandle === c.handle} />

                {/* Herz/gebrochenes Herz blenden mit dem Wisch-Fortschritt ein */}
                <SwipeFollowOverlay label="folgen" />
                <SwipeFollowOverlay label="entfolgen" direction="left" />

                {/* Bottom overlay — Ort/Zeit + Handle; Folgen per Rechts-Wisch.
                    🔒 KEINE Reaktions- oder Follower-Zahlen sichtbar (PRD §4.6). */}
                <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                  <div className="flex items-center gap-1.5 text-white/70 mb-2.5">
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      location_on
                    </span>
                    <span className="text-xs font-medium tracking-tight">{CITY}</span>
                    <span className="text-white/40 text-xs">· Stadt Corso</span>
                  </div>
                  <div className="flex justify-between items-end">
                    {/* Reiner Text — kein Einstieg in eine Zwischenebene mehr
                        (9. Sep 2026): geblättert wird direkt auf der Kachel. */}
                    <span className="text-white text-lg font-semibold tracking-tight drop-shadow-md">
                      {c.handle}
                    </span>
                    {circleIds.has(c.authorId) ? (
                      // Achse 2 — folgen wäre wirkungslos, also gar nicht anbieten.
                      <div className="pointer-events-none flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 backdrop-blur-md">
                        <span className="material-symbols-outlined text-[16px] leading-none text-white">
                          hub
                        </span>
                        <span className="text-xs font-semibold text-white">in deinem Circle</span>
                      </div>
                    ) : isFollowing(c.handle) ? (
                      // Reiner Status, kein Button — der Clip bleibt in der Story.
                      <div className="pointer-events-none flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5">
                        <span className="text-xs font-semibold text-black">folgst du</span>
                        <span
                          className="material-symbols-outlined text-[16px] leading-none text-black"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          favorite
                        </span>
                      </div>
                    ) : (
                      <SwipeHintChip label="wischen zum Folgen" />
                    )}
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

      {/* Läuft-noch-Anzeige — die Story steht bis zur nächsten Ziehung um 21:00. */}
      <CorsoRunningBadge />

      <SwipeHint />
    </div>
  );
}

// Dezente Pille oben mittig. Früher zeigte sie die Restzeit bis zur nächsten
// 21:00-Ziehung — die gibt es nicht mehr. Jetzt sagt sie nur noch, dass man den
// laufenden Corso sieht: er wechselt, sobald jemand nachrückt.
function CorsoRunningBadge() {
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
        <span className="text-white text-xs font-medium tracking-tight">Stadt Corso · läuft</span>
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
            background: "linear-gradient(180deg, rgba(20,30,60,0.35) 0%, rgba(0,0,0,0) 60%)",
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

        <div className="flex flex-col items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.4em] text-white/50 font-medium">
            Stadt Corso
          </span>
          <span className="text-2xl font-semibold tracking-tight text-white">
            Die Bühne ist frei
          </span>
        </div>

        <p className="text-sm text-white/60 max-w-xs">
          Gerade zeigt niemand in {CITY} etwas. Sobald jemand einen Moment freigibt, steht er hier —
          vielleicht deiner.
        </p>
      </div>
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
