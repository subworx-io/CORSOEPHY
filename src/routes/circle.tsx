import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HapticTapTarget } from "@/components/haptic-tap";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { isControlTap, tapDirection } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useCircle, type CirclePartner } from "@/lib/circle/use-circle";
import { useCircleInbox } from "@/lib/circle/inbox-context";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { recordView } from "@/lib/record-view";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { MomentMenu } from "@/components/moment-menu";
import { CircleChat } from "@/components/circle-chat";
import { SequenceMedia } from "@/components/sequence-media";
import { MomentProgress } from "@/components/moment-progress";
import { useMomentSequence, firstStepOf, type SequenceMoment } from "@/hooks/use-moment-sequence";

// Der Circle (Achse 2): beständige, gegenseitige Verbindungen. Kein Verfall,
// kein Erneuern — aber die MOMENTE der Partner folgen weiter der 24h-Regel:
// im Feed steht nur, wer gerade einen lebenden Moment hat. Die Partner-Leiste
// oben ist dagegen beständig — der Chat ist immer erreichbar, auch wenn jemand
// gerade nichts zeigt (Entscheidung Dominik, 2. Sep 2026).
// 🔒 Keine Zähler, keine Schwellen-Anzeige: der Circle-Eintritt ist eine Überraschung.

export const Route = createFileRoute("/circle")({
  validateSearch: (search: Record<string, unknown>): { chat?: string } => ({
    chat: typeof search.chat === "string" ? search.chat : undefined,
  }),
  head: () => ({
    meta: [{ title: "Circle — Corso" }, { name: "description", content: "Menschen, die bleiben." }],
  }),
  component: CirclePage,
});

// Circle-Link erzeugen + teilen (Entscheidung Dominik, 2. Sep 2026): der Link
// geht an Freunde AUSSERHALB der App; wer ihn öffnet, landet direkt mit dem
// Einladenden im Circle (zweiter Eintrittsweg neben dem 5-Tage-Ritual, 0026).
// Ein Link gilt für EINE Person und 7 Tage — jeder Tap erzeugt einen frischen.
function useCircleInviteShare() {
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_circle_invite");
      if (error || typeof data !== "string") throw error ?? new Error("kein Token");
      const url = `${window.location.origin}/c/${data}`;
      if (navigator.share) {
        await navigator.share({
          title: "Corso",
          text: "Komm in meinen Circle bei Corso — der Link gilt für dich:",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Circle-Link kopiert — gilt für eine Person, 7 Tage.");
      }
    } catch (e) {
      // Share-Sheet zugemacht = kein Fehler; der erzeugte Token verfällt einfach.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast.error("Circle-Link konnte nicht erstellt werden.");
      }
    } finally {
      setBusy(false);
    }
  };

  return { share, busy };
}

// Stabile leere Liste — eine frische [] pro Render würde die Sequenz zurücksetzen.
const EMPTY_MOMENTS: SequenceMoment[] = [];

function CirclePage() {
  const { user } = useAuth();
  const { partners } = useCircle();
  // Ungelesene Nachrichten — Punkt am jeweiligen Partner-Chip, damit man sieht,
  // WER geschrieben hat, nicht nur DASS jemand geschrieben hat.
  // 🔒 Punkt, keine Anzahl.
  const { unreadPartnerIds } = useCircleInbox();
  const navigate = useNavigate();
  const { chat } = Route.useSearch();
  const invite = useCircleInviteShare();

  const partnerIdsKey = partners
    .map((p) => p.partnerId)
    .sort()
    .join(",");

  // ALLE lebenden Momente der Partner als Sequenz — gleiche Mechanik wie im
  // „Ich folge"-Feed (In-Place-Blättern, 9. Sep 2026).
  const { data: momentsById = {} } = useQuery<Record<string, SequenceMoment[]>>({
    queryKey: ["circle-moments", partnerIdsKey],
    queryFn: async () => {
      const ids = partnerIdsKey.split(",").filter(Boolean);
      if (!ids.length) return {};
      const { data: posts } = await supabase
        .from("posts")
        .select("id, media_path, media_type, media_paths, author_id")
        .in("author_id", ids)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (!posts?.length) return {};

      const pathsOf = (post: {
        media_path: string;
        media_type: string;
        media_paths: string[] | null;
      }) =>
        post.media_type === "photo" && post.media_paths?.length
          ? post.media_paths
          : [post.media_path];

      const urlsByPath = await getSignedMomentUrls(posts.flatMap((p) => pathsOf(p)));

      // Query liefert created_at DESC; innerhalb einer Person umdrehen, damit
      // man chronologisch vorwärts blättert.
      const result: Record<string, SequenceMoment[]> = {};
      for (const post of posts) {
        const urls = pathsOf(post)
          .map((path) => urlsByPath[path])
          .filter((u): u is string => !!u);
        if (!urls.length) continue;
        const isPhoto = post.media_type === "photo";
        (result[post.author_id] ??= []).unshift({
          postId: post.id,
          authorId: post.author_id,
          videoUrl: isPhoto ? null : urls[0],
          photoUrls: isPhoto ? urls : null,
        });
      }
      return result;
    },
    enabled: !!user && partners.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Sichtbar im Feed ist nur, wer gerade einen lebenden Moment hat.
  const withMoment = partners.filter((p) => momentsById[p.partnerId]?.length);

  const { currentIndex, slideRef, containerRef, snapTo } = useSnapScroll({
    count: withMoment.length,
    axis: "y",
    // Tipp = ein Schritt weiter in der Sequenz, linkes Drittel = zurück.
    // Die „Nachricht"-Pille und die Partner-Leiste sind ausgenommen — sie sind
    // Bedienelemente und führen weiterhin in den Chat (isControlTap).
    onTap: ({ index, x, y, target }) => {
      if (isControlTap(target)) return;
      if (index !== currentIndexRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (tapDirection(x, y, rect) === "prev") seqRef.current?.prev();
      else seqRef.current?.next();
    },
  });

  // Sequenz des aktiven Partners.
  const activePartner = withMoment[currentIndex];
  const seq = useMomentSequence({
    moments: (activePartner && momentsById[activePartner.partnerId]) || EMPTY_MOMENTS,
    isActive: true,
    onExhausted: () => snapTo(Math.min(withMoment.length - 1, currentIndex + 1)),
  });
  const seqRef = useRef(seq);
  seqRef.current = seq;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  // Ansicht verbuchen (Verweil-Schwelle wie überall — Views sind Kill-Metrik).
  // Verbucht wird der Moment, auf dem die Sequenz gerade steht.
  const activePostId = seq.step?.postId;
  useEffect(() => {
    if (!activePostId) return;
    const t = setTimeout(() => recordView(activePostId), 500);
    return () => clearTimeout(t);
  }, [activePostId]);

  const chatPartner = chat ? partners.find((p) => p.partnerId === chat) : undefined;
  const openChat = (partner: CirclePartner) =>
    void navigate({ to: "/circle", search: { chat: partner.partnerId } });
  const closeChat = () => void navigate({ to: "/circle", search: {} });

  if (partners.length === 0) {
    return (
      <div className="relative flex h-dvh w-full flex-col items-center justify-center bg-neutral-950 px-8 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/8">
          <span className="material-symbols-outlined text-[36px] text-white/25">group</span>
        </div>
        <p className="text-lg font-semibold tracking-tight text-white">Dein Circle ist noch leer</p>
        <p className="mt-2 max-w-[17rem] text-sm leading-snug text-white/40">
          Wenn ihr euch über Tage immer wieder gegenseitig folgt, entsteht daraus eine Verbindung,
          die bleibt. Hier könnt ihr euch dann schreiben.
        </p>
        {/* Leerer Circle → der Link-Weg steht zentral (Umsetzung Punkt 12). */}
        <span className="relative mt-7 inline-flex">
          <HapticTapTarget
            label="Circle-Einladung teilen"
            onTap={() => {
              if (invite.busy) return;
              void invite.share();
            }}
            disabled={invite.busy}
          />
          <button
            onClick={() => void invite.share()}
            disabled={invite.busy}
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">person_add</span>
            {invite.busy ? "Link wird erstellt …" : "Freund:in in den Circle holen"}
          </button>
        </span>
        <p className="mt-2.5 max-w-[16rem] text-[11px] leading-snug text-white/35">
          Du bekommst einen Link zum Verschicken — gilt für eine Person, 7 Tage.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      {/* Feed: nur Partner mit lebendem Moment */}
      {withMoment.length > 0 ? (
        <div ref={containerRef} className="absolute inset-0" style={{ touchAction: "none" }}>
          {withMoment.map((partner, i) => {
            const offset = i - currentIndex;
            const isActive = offset === 0;
            const isNeighbor = Math.abs(offset) === 1;
            const moments = momentsById[partner.partnerId] ?? EMPTY_MOMENTS;

            return (
              <div
                key={partner.partnerId}
                ref={slideRef(i)}
                className="absolute inset-0 h-full w-full"
                style={{ zIndex: isActive ? 10 : isNeighbor ? 5 : 0 }}
              >
                <div
                  className="absolute inset-0 px-4"
                  style={{
                    // Mehr Kopffreiheit als in Discovery: oben sitzt die Partner-Leiste.
                    paddingTop: "calc(env(safe-area-inset-top) + 4.5rem)",
                    paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
                  }}
                >
                  <div
                    className="relative h-full w-full overflow-hidden rounded-[2rem]"
                    style={{
                      boxShadow:
                        "0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.6)",
                    }}
                  >
                    {(() => {
                      const shown = isActive
                        ? { step: seq.step, moment: seq.currentMoment }
                        : firstStepOf(moments);
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

                    {/* Fortschritt der Sequenz — unter der Partner-Leiste. */}
                    {isActive && seq.hasSequence && (
                      <div className="pointer-events-none absolute inset-x-4 top-3 z-20">
                        <MomentProgress groups={seq.groups} stepIndex={seq.stepIndex} />
                      </div>
                    )}

                    <div className="absolute top-4 right-4 z-20">
                      <MomentMenu
                        reportedUserId={partner.partnerId}
                        reportedPostId={(isActive ? seq.step?.postId : moments[0]?.postId) ?? null}
                        handle={partner.handle}
                      />
                    </div>

                    {/* Bottom overlay: Handle + Chat-Einstieg. Kein Erneuern, kein
                        Verfalls-Herz — die Verbindung ist beständig. */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-5">
                      <div className="flex items-end justify-between gap-3">
                        <span className="min-w-0 truncate text-lg font-semibold tracking-tight text-white drop-shadow-md">
                          {partner.handle}
                        </span>
                        <span className="relative inline-flex">
                          <HapticTapTarget label="Chat öffnen" onTap={() => openChat(partner)} />
                          <button
                            onClick={() => openChat(partner)}
                            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition-all active:scale-95"
                          >
                            <span className="material-symbols-outlined text-[16px] leading-none">
                              chat
                            </span>
                            Nachricht
                          </button>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Verbindung beständig, Moment flüchtig: gerade zeigt niemand etwas.
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <span className="material-symbols-outlined mb-4 text-[32px] text-white/25">
            nights_stay
          </span>
          <p className="text-base font-semibold tracking-tight text-white">
            Gerade zeigt niemand einen Moment
          </p>
          <p className="mt-2 max-w-[16rem] text-sm leading-snug text-white/40">
            Dein Circle bleibt — Momente vergehen. Schreib ihnen über die Leiste oben.
          </p>
        </div>
      )}

      {/* Partner-Leiste — beständig, unabhängig vom Moment-Verfall. Chat-Einstieg
          für ALLE Partner, auch ohne lebenden Moment. Rechts angepinnt: der
          Circle-Link als kleines person_add-Icon (Punkt 12 — gefüllter Circle). */}
      <header
        className="absolute left-0 right-0 top-0 z-30"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <div className="flex items-center gap-2 px-4 pb-2">
          <div
            className="flex min-w-0 flex-1 gap-2 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {partners.map((partner) => {
              const unread = unreadPartnerIds.has(partner.partnerId);
              return (
                <span key={partner.partnerId} className="relative inline-flex shrink-0">
                  <HapticTapTarget label="Partner öffnen" onTap={() => openChat(partner)} />
                  <button
                    onClick={() => openChat(partner)}
                    aria-label={
                      unread
                        ? `${partner.displayName || partner.handle} – neue Nachricht`
                        : partner.displayName || partner.handle
                    }
                    className={`relative flex shrink-0 items-center gap-2 rounded-full border bg-black/45 py-1.5 pl-1.5 pr-3.5 backdrop-blur-md transition-transform active:scale-[0.97] ${
                      unread ? "border-white/50" : "border-white/15"
                    }`}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[13px] font-semibold uppercase text-white">
                      {partner.handle.replace(/^@/, "").charAt(0)}
                    </span>
                    <span
                      className={`max-w-[8rem] truncate text-[13px] ${
                        unread ? "font-semibold text-white" : "font-medium text-white"
                      }`}
                    >
                      {partner.displayName || partner.handle}
                    </span>
                    {unread && (
                      <span
                        className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5"
                        aria-hidden
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-black/40 bg-white" />
                      </span>
                    )}
                  </button>
                </span>
              );
            })}
          </div>
          <span className="relative inline-flex shrink-0">
            <HapticTapTarget
              label="Circle-Einladung teilen"
              onTap={() => {
                if (invite.busy) return;
                void invite.share();
              }}
              disabled={invite.busy}
            />
            <button
              onClick={() => void invite.share()}
              disabled={invite.busy}
              aria-label="Freund:in per Link in den Circle holen"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/45 backdrop-blur-md transition-transform active:scale-95 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[20px] leading-none text-white/85">
                person_add
              </span>
            </button>
          </span>
        </div>
      </header>

      {/* Seitenindikatoren */}
      {withMoment.length > 1 && (
        <div className="absolute top-1/2 right-3 z-20 flex -translate-y-1/2 flex-col gap-1.5">
          {withMoment.map((p, i) => (
            <div
              key={p.partnerId}
              className={`w-1.5 rounded-full transition-all duration-300 ${
                i === currentIndex ? "h-6 bg-white shadow-lg" : "h-1.5 bg-white/40"
              }`}
            />
          ))}
        </div>
      )}

      {chatPartner && <CircleChat partner={chatPartner} onClose={closeChat} />}
    </div>
  );
}
