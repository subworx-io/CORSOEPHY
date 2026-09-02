import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useCircle, type CirclePartner } from "@/lib/circle/use-circle";
import { useSnapScroll } from "@/hooks/use-snap-scroll";
import { recordView } from "@/lib/record-view";
import { fetchPromptsByDate } from "@/lib/prompts/prompt-history";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { MomentPrompt } from "@/components/moment-prompt";
import { MomentMenu } from "@/components/moment-menu";
import { PhotoStackTile } from "@/components/photo-stack";
import { CircleChat } from "@/components/circle-chat";
import { VideoTile } from "@/components/video-tile";

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

// Lebender Moment eines Circle-Partners (Video ODER Foto-Stapel) + sein Prompt.
type PartnerMoment = {
  videoUrl?: string;
  photoUrls?: string[];
  postId: string;
  prompt: { text: string; date: string } | null;
};

function CirclePage() {
  const { user } = useAuth();
  const { partners } = useCircle();
  const navigate = useNavigate();
  const { chat } = Route.useSearch();
  const invite = useCircleInviteShare();

  const partnerIdsKey = partners
    .map((p) => p.partnerId)
    .sort()
    .join(",");

  // Lebende Momente der Partner — gleiche Mechanik wie im „Ich folge"-Feed:
  // nur `expires_at > now()`, neuester Post pro Person, Foto-Stapel unterstützt.
  const { data: momentsById = {} } = useQuery<Record<string, PartnerMoment>>({
    queryKey: ["circle-moments", partnerIdsKey],
    queryFn: async () => {
      const ids = partnerIdsKey.split(",").filter(Boolean);
      if (!ids.length) return {};
      const { data: posts } = await supabase
        .from("posts")
        .select("id, media_path, media_type, media_paths, author_id, prompt_date")
        .in("author_id", ids)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (!posts?.length) return {};

      const newestByAuthor = new Map<string, (typeof posts)[number]>();
      for (const post of posts) {
        if (!newestByAuthor.has(post.author_id)) newestByAuthor.set(post.author_id, post);
      }
      const newest = Array.from(newestByAuthor.values());

      const pathsOf = (post: {
        media_path: string;
        media_type: string;
        media_paths: string[] | null;
      }) =>
        post.media_type === "photo" && post.media_paths?.length
          ? post.media_paths
          : [post.media_path];

      const [promptsByDate, urlsByPath] = await Promise.all([
        fetchPromptsByDate(newest.map((p) => p.prompt_date)),
        getSignedMomentUrls(newest.flatMap((p) => pathsOf(p))),
      ]);

      const result: Record<string, PartnerMoment> = {};
      for (const post of newest) {
        const urls = pathsOf(post)
          .map((path) => urlsByPath[path])
          .filter((u): u is string => !!u);
        if (!urls.length) continue;
        const promptText = promptsByDate[post.prompt_date];
        result[post.author_id] = {
          videoUrl: post.media_type === "photo" ? undefined : urls[0],
          photoUrls: post.media_type === "photo" ? urls : undefined,
          postId: post.id,
          prompt: promptText ? { text: promptText, date: post.prompt_date } : null,
        };
      }
      return result;
    },
    enabled: !!user && partners.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Sichtbar im Feed ist nur, wer gerade einen lebenden Moment hat.
  const withMoment = partners.filter((p) => momentsById[p.partnerId]);

  const { currentIndex, slideRef, containerRef } = useSnapScroll({
    count: withMoment.length,
    axis: "y",
  });

  // Ansicht verbuchen (Verweil-Schwelle wie überall — Views sind Kill-Metrik).
  const activeMoment = withMoment[currentIndex]
    ? momentsById[withMoment[currentIndex].partnerId]
    : undefined;
  useEffect(() => {
    if (!activeMoment?.postId) return;
    const t = setTimeout(() => recordView(activeMoment.postId), 500);
    return () => clearTimeout(t);
  }, [activeMoment?.postId]);

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
        <button
          onClick={() => void invite.share()}
          disabled={invite.busy}
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px] leading-none">person_add</span>
          {invite.busy ? "Link wird erstellt …" : "Freund:in in den Circle holen"}
        </button>
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
            const moment = momentsById[partner.partnerId];

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
                    {moment.photoUrls ? (
                      <PhotoStackTile urls={moment.photoUrls} isActive={isActive} />
                    ) : moment.videoUrl ? (
                      <VideoTile src={moment.videoUrl} isActive={isActive} />
                    ) : null}

                    <div className="absolute top-4 right-4 z-20">
                      <MomentMenu
                        reportedUserId={partner.partnerId}
                        reportedPostId={moment.postId}
                        handle={partner.handle}
                      />
                    </div>

                    {moment.prompt && (
                      <MomentPrompt text={moment.prompt.text} date={moment.prompt.date} />
                    )}

                    {/* Bottom overlay: Handle + Chat-Einstieg. Kein Erneuern, kein
                        Verfalls-Herz — die Verbindung ist beständig. */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-5">
                      <div className="flex items-end justify-between gap-3">
                        <span className="min-w-0 truncate text-lg font-semibold tracking-tight text-white drop-shadow-md">
                          {partner.handle}
                        </span>
                        <button
                          onClick={() => openChat(partner)}
                          className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition-all active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[16px] leading-none">
                            chat
                          </span>
                          Nachricht
                        </button>
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
            {partners.map((partner) => (
              <button
                key={partner.partnerId}
                onClick={() => openChat(partner)}
                className="flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-black/45 py-1.5 pl-1.5 pr-3.5 backdrop-blur-md transition-transform active:scale-[0.97]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[13px] font-semibold uppercase text-white">
                  {partner.handle.replace(/^@/, "").charAt(0)}
                </span>
                <span className="max-w-[8rem] truncate text-[13px] font-medium text-white">
                  {partner.displayName || partner.handle}
                </span>
              </button>
            ))}
          </div>
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
