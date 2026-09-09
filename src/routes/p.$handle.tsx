import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useFollow, canRenew } from "@/lib/follow-context";
import { useCircle } from "@/lib/circle/use-circle";
import { HeartBurst, useHeartBurst } from "@/components/heart-burst";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { recordView } from "@/lib/record-view";
import { MomentMenu } from "@/components/moment-menu";
import { SequenceMedia } from "@/components/sequence-media";
import { MomentProgress } from "@/components/moment-progress";
import { useMomentSequence, type SequenceMoment } from "@/hooks/use-moment-sequence";
import { haptic } from "@/lib/haptics";
import { isControlTap, tapDirection } from "@/lib/utils";

// Profil als DEEP-LINK-Ziel (Entscheidung Dominik, 9. Sep 2026, Variante b).
//
// ⚠️ WICHTIG: Aus den Feeds führt hierher KEIN Weg mehr. Seit dem
// In-Place-Blättern blättert man die Momente eines Menschen direkt auf seiner
// Kachel durch — es öffnet sich keine Zwischenebene. Diese Route bleibt nur für
// Links von außen: der Push „Du stehst im Corso", geteilte Links, künftige
// Verweise. Wer hier wieder einen Tap-Einstieg von einer Kachel einbaut, stellt
// die abgeschaffte Zwischenebene wieder her — nicht tun.
//
// Innen gilt exakt dieselbe Mechanik wie in den Feeds (`useMomentSequence`):
// eine flache Sequenz aus Momenten und Bildern, rechte Hauptfläche = weiter,
// linkes Drittel = zurück, ein Fortschrittsbalken. Ein X gibt es nur hier —
// anders als eine Feed-Kachel ist das ein eigener Screen, aus dem man
// zurückkommen muss.

export const Route = createFileRoute("/p/$handle")({
  head: () => ({
    meta: [{ title: "Profil" }],
  }),
  component: ProfilePage,
});

/** Ab dieser Zieh-Strecke nach unten schließt die Ansicht. */
const DISMISS_PX = 110;
const EMPTY_MOMENTS: SequenceMoment[] = [];

interface ProfileData {
  id: string;
  handle: string;
  displayName: string | null;
  moments: SequenceMoment[];
}

/** „vor 3 Std." — die Momente einer Person liegen alle innerhalb von 24 h. */
function ageLabel(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  return `vor ${hours} Std.`;
}

function ProfilePage() {
  const { handle: rawHandle } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isFollowing, follow, unfollow, renew, followed } = useFollow();
  // Circle-Partner: folgen wäre wirkungslos (sie erscheinen nie in „Ich folge",
  // PRD §4.4). Statt des Knopfes steht hier ihr Status.
  const { partnerIds: circleIds } = useCircle();
  const { burstHandle, triggerBurst } = useHeartBurst();

  // Handles liegen MIT führendem @ in der DB. Die Route akzeptiert beide
  // Schreibweisen, damit ein Link von Hand nicht ins Leere läuft. Gebaut werden
  // die Links ohne @ (handleParam) — ein unkodiertes @ im Pfad quittiert
  // Cloudflare Pages mit 404.
  const normalized = `@${rawHandle.replace(/^@/, "")}`;

  const { data, isLoading } = useQuery({
    queryKey: ["profile-moments", normalized, user?.id],
    queryFn: async (): Promise<ProfileData | null> => {
      if (!user) return null;

      const { data: prof, error: profError } = await supabase
        .from("profiles")
        .select("id, handle, display_name")
        .eq("handle", normalized)
        .maybeSingle();
      if (profError || !prof) return null;

      // Nur LEBENDE Momente. Block-Filter und Verfall stecken in der RLS-Policy
      // `posts_read_living` (0015/0017) — hier braucht es keine eigene Funktion.
      // Aufsteigend: man blättert chronologisch vorwärts durch ihren Tag.
      const { data: posts, error } = await supabase
        .from("posts")
        .select("id, author_id, media_path, media_type, media_paths, created_at")
        .eq("author_id", prof.id)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true });
      if (error || !posts?.length) {
        return { id: prof.id, handle: prof.handle, displayName: prof.display_name, moments: [] };
      }

      const pathsOf = (post: {
        media_path: string;
        media_type: string;
        media_paths: string[] | null;
      }) =>
        post.media_type === "photo" && post.media_paths?.length
          ? post.media_paths
          : [post.media_path];

      const urlsByPath = await getSignedMomentUrls(posts.flatMap((p) => pathsOf(p)));

      const moments = posts.flatMap((post): SequenceMoment[] => {
        const urls = pathsOf(post)
          .map((path) => urlsByPath[path])
          .filter((u): u is string => !!u);
        if (!urls.length) return [];
        const isPhoto = post.media_type === "photo";
        return [
          {
            postId: post.id,
            authorId: post.author_id,
            videoUrl: isPhoto ? null : urls[0],
            photoUrls: isPhoto ? urls : null,
            createdAt: post.created_at,
          },
        ];
      });

      return { id: prof.id, handle: prof.handle, displayName: prof.display_name, moments };
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const moments = useMemo(() => data?.moments ?? EMPTY_MOMENTS, [data]);

  const close = useCallback(() => {
    // Zurück, wenn es eine Vorgeschichte gibt — sonst in die Stadt.
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else void navigate({ to: "/" });
  }, [navigate]);

  // Hier ist das Ende der Sequenz wirklich das Ende: es gibt keine nächste
  // Person, zu der gesprungen werden könnte. Also bleibt es stehen.
  const seq = useMomentSequence({ moments, isActive: true });

  // Ansicht verbuchen wie in den Feeds — 500-ms-Verweil-Schwelle, damit
  // Durchblättern nicht als „gesehen" zählt (Views ist Kill-Metrik).
  const activePostId = seq.step?.postId;
  useEffect(() => {
    if (!activePostId) return;
    const t = setTimeout(() => recordView(activePostId), 500);
    return () => clearTimeout(t);
  }, [activePostId]);

  // ── Wisch nach unten = schließen ──────────────────────────────────────────
  // Kein Snap-Container mehr (es gibt nur diese eine Person), deshalb ein
  // eigener kleiner Handler — und deshalb funktionieren hier normale
  // click-Ereignisse für die Tipp-Zonen (siehe TapInfo in use-snap-scroll.ts).
  const sheetRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let startY = 0;
    let startX = 0;
    let dragging = false;
    let locked = false;

    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dragging = true;
      locked = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      // Erst ab eindeutiger Richtung übernehmen — sonst zuckt die Ansicht bei
      // jeder waagerechten Bewegung nach unten weg.
      if (!locked) {
        if (Math.abs(dy) < 12 && Math.abs(dx) < 12) return;
        if (Math.abs(dy) <= Math.abs(dx)) {
          dragging = false;
          return;
        }
        locked = true;
      }
      if (dy <= 0) return; // nur nach unten
      if (sheetRef.current) {
        sheetRef.current.style.transition = "";
        sheetRef.current.style.transform = `translateY(${dy}px)`;
        sheetRef.current.style.opacity = String(Math.max(0.4, 1 - dy / 500));
      }
    };
    const onEnd = (e: TouchEvent) => {
      const wasLocked = locked;
      dragging = false;
      locked = false;
      if (!wasLocked) return;
      const dy = e.changedTouches[0].clientY - startY;
      if (dy > DISMISS_PX) {
        haptic("tap");
        close();
        return;
      }
      if (sheetRef.current) {
        sheetRef.current.style.transition =
          "transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 260ms";
        sheetRef.current.style.transform = "";
        sheetRef.current.style.opacity = "1";
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [close]);

  const displayHandle = data?.handle ?? normalized;
  const following = isFollowing(displayHandle);
  const person = followed.get(displayHandle);
  const renewable = following && person ? canRenew(person.followedAt, Date.now()) : false;
  const isSelf = data?.id === user?.id;
  const isCirclePartner = !!data?.id && circleIds.has(data.id);

  function onFollowTap() {
    if (!following) {
      follow({ handle: displayHandle, src: null });
      triggerBurst(displayHandle);
      return;
    }
    if (renewable) {
      renew(displayHandle);
      triggerBurst(displayHandle);
      return;
    }
    unfollow(displayHandle);
  }

  return (
    <div ref={sheetRef} className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      {/* Kopf: Handle + Schließen. Liegt über der Karte. */}
      <header
        className="absolute top-0 left-0 right-0 z-30 px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-white text-base font-semibold tracking-tight drop-shadow">
              {displayHandle}
            </span>
            {seq.step?.createdAt && (
              <span className="text-[11px] text-white/50">{ageLabel(seq.step.createdAt)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {seq.step && !isSelf && (
              <MomentMenu
                reportedUserId={seq.step.authorId}
                reportedPostId={seq.step.postId}
                handle={displayHandle}
              />
            )}
            <button
              onClick={close}
              aria-label="Profil schließen"
              className="h-9 w-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-white text-[20px]">close</span>
            </button>
          </div>
        </div>
      </header>

      <div
        className="absolute inset-0 px-4"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 4rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
        }}
      >
        <div
          ref={cardRef}
          className="relative h-full w-full overflow-hidden rounded-[2rem] bg-neutral-900"
          // Dieselben Tipp-Zonen wie in den Feeds.
          onClick={(e) => {
            if (isControlTap(e.target)) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (tapDirection(e.clientX, e.clientY, rect) === "prev") seq.prev();
            else seq.next();
          }}
        >
          {seq.step && (
            <SequenceMedia
              step={seq.step}
              moment={seq.currentMoment}
              isActive
              isLastStep={seq.isLastStep}
              onEnded={seq.autoNext}
            />
          )}

          {seq.hasSequence && (
            <div className="pointer-events-none absolute inset-x-4 top-3 z-20">
              <MomentProgress groups={seq.groups} stepIndex={seq.stepIndex} />
            </div>
          )}

          <HeartBurst active={burstHandle === displayHandle} />

          {/* Leerzustände — ehrlich, kein Auffüllen. */}
          {!isLoading && !seq.step && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 text-center">
              <span className="material-symbols-outlined text-[36px] text-white/30">
                nights_stay
              </span>
              <span className="text-white/70 text-sm">
                {data
                  ? `${displayHandle} zeigt gerade nichts.`
                  : "Diese Person gibt es hier nicht."}
              </span>
              {data && (
                <span className="text-white/40 text-xs max-w-[16rem]">
                  Momente leben 24 Stunden. Was älter ist, ist überall weg.
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Folgen — expliziter Knopf. In den Feeds läuft das über den Quer-Wisch;
          den gibt es hier nicht, also braucht es ein sichtbares Bedienelement.
          🔒 Keine Follower-Zahl, weder eigene noch fremde. */}
      {data && !isSelf && (
        <div
          className="absolute left-0 right-0 z-30 flex justify-center px-6"
          style={{ bottom: "calc(max(env(safe-area-inset-bottom), 24px) + 3.4rem)" }}
        >
          {isCirclePartner ? (
            <div className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-md">
              <span className="material-symbols-outlined text-[18px] leading-none">hub</span>
              in deinem Circle
            </div>
          ) : (
            <button
              onClick={onFollowTap}
              className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold active:scale-95 transition-transform ${
                following && !renewable
                  ? "bg-white/15 text-white backdrop-blur-md"
                  : "bg-white text-black"
              }`}
            >
              <span
                className="material-symbols-outlined text-[18px] leading-none"
                style={{ fontVariationSettings: following ? "'FILL' 1" : undefined }}
              >
                favorite
              </span>
              {!following ? "Folgen" : renewable ? "Erneuern" : "Folgst du"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
