import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { HapticTapTarget } from "@/components/haptic-tap";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { getSignedMomentUrls } from "@/lib/supabase/signed-urls";
import { CityStoryHitSplash } from "@/components/city-story-hit-splash";
import { SequenceMedia } from "@/components/sequence-media";
import { MomentProgress } from "@/components/moment-progress";
import { useMomentSequence, type SequenceMoment } from "@/hooks/use-moment-sequence";
import type { MyFeedback } from "@/lib/supabase/types";
import { isControlTap, tapDirection } from "@/lib/utils";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "Rücklauf — Corso" },
      {
        name: "description",
        content: "Was dein Moment eingebracht hat — und was verfällt. Nur für dich.",
      },
    ],
  }),
  component: FeedbackPage,
});

interface FeedbackData {
  feedback: MyFeedback;
  /** ALLE eigenen lebenden Momente, chronologisch — die Sequenz zum Blättern. */
  moments: SequenceMoment[];
}

// Stabile leere Liste — eine frische [] pro Render würde die Sequenz zurücksetzen.
const EMPTY_MOMENTS: SequenceMoment[] = [];

/** Moment-bezogene Zahlen aus my_moment_stats() (Migration 0033/0034). */
interface MomentStats {
  views: number;
  stayed: number;
  moment_live: boolean;
  in_city_story: boolean;
  is_record: boolean;
  consent: boolean;
  moment_created_at: string | null;
  moment_expires_at: string | null;
}

function FeedbackPage() {
  const { user, profile } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["my-feedback", user?.id],
    queryFn: async (): Promise<FeedbackData | null> => {
      if (!user) return null;

      // Alle Zahlen kommen aus my_feedback() — argumentlos, an auth.uid() gepinnt.
      // Es gibt bewusst keinen Weg, die Zahlen eines anderen abzufragen.
      const { data: rows, error } = await supabase.rpc("my_feedback");
      if (error) return null;
      const feedback =
        (Array.isArray(rows) ? (rows[0] as MyFeedback) : (rows as MyFeedback)) ?? null;
      if (!feedback) return null;

      // ALLE eigenen lebenden Momente, chronologisch aufsteigend — dieselbe
      // Sequenz-Logik wie in den Feeds (In-Place-Blättern, 9. Sep 2026).
      // Abgelaufene Posts sind per RLS auch für den Autor weg (0015); der Screen
      // friert dann nur die Zahlen ein, nicht den Moment selbst.
      const { data: posts } = await supabase
        .from("posts")
        .select("id, author_id, media_path, media_type, media_paths, created_at")
        .eq("author_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true });

      const pathsOf = (post: {
        media_path: string;
        media_type: string;
        media_paths: string[] | null;
      }) =>
        post.media_type === "photo" && post.media_paths?.length
          ? post.media_paths
          : [post.media_path];

      const urlsByPath = await getSignedMomentUrls((posts ?? []).flatMap((p) => pathsOf(p)));
      const moments = (posts ?? []).flatMap((post): SequenceMoment[] => {
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

      return { feedback, moments };
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Die Sequenz der eigenen Momente. Der Rücklauf ist KEIN Snap-Container
  // (natives Scrollen), deshalb reicht hier ein normales onClick — das
  // preventDefault-Problem aus den Feeds gibt es nur dort.
  const moments = data?.moments ?? EMPTY_MOMENTS;
  const seq = useMomentSequence({ moments, isActive: true });

  // 🔒 Zahlen zum GERADE ANGEZEIGTEN Moment (my_moment_stats, 0033/0034).
  // Ohne das zeigte der Rücklauf beim Blättern weiter die Zahlen von Moment 1.
  // Die Funktion prüft serverseitig author_id = auth.uid() — eine fremde
  // post_id liefert keine Zeile.
  const activePostId = seq.step?.postId ?? null;
  const { data: stats } = useQuery({
    queryKey: ["moment-stats", activePostId],
    queryFn: async (): Promise<MomentStats | null> => {
      if (!activePostId) return null;
      const { data: rows, error } = await supabase.rpc("my_moment_stats", {
        p_post_id: activePostId,
      });
      if (error) return null;
      const row = Array.isArray(rows) ? rows[0] : rows;
      return (row as MomentStats) ?? null;
    },
    enabled: !!activePostId,
    staleTime: 30_000,
  });

  if (!user) {
    return <Centered icon="lock">Melde dich an, um deinen Rücklauf zu sehen.</Centered>;
  }

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950">
        <span className="text-white/30 text-sm animate-pulse">Lädt…</span>
      </div>
    );
  }

  if (!data) {
    return <Centered icon="insights">Dein Rücklauf ist gerade nicht verfügbar.</Centered>;
  }

  const { feedback } = data;
  const hasMoment = moments.length > 0 || !!feedback.moment_id;
  // Moment-bezogene Zahlen kommen aus `stats` (blättert mit), personen-bezogene
  // (Follower, auf der Kippe, Serie) weiterhin aus my_feedback().
  const views = stats?.views ?? feedback.views;
  const stayed = stats?.stayed ?? feedback.stayed;
  const isRecord = stats?.is_record ?? feedback.is_record;
  const live = stats?.moment_live ?? feedback.moment_live;
  const consent = stats?.consent ?? false;

  return (
    // Der Root-Container ist h-dvh + overflow-hidden (für die Snap-Feeds), also
    // bringt dieser Screen sein eigenes Scrollen mit — wie settings.tsx.
    <div
      className="relative h-dvh w-full overflow-y-auto overscroll-contain bg-neutral-950"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 7rem)",
      }}
    >
      {/* Der Aufstieg als eigener Moment — einmal pro Corso-Tag */}
      <CityStoryHitSplash active={feedback.in_city_story} />

      {/* Kopf: dein Ort in der App (PRD Screen 9 lebt hier) */}
      <header className="flex items-center justify-between px-5">
        <div className="min-w-0">
          <div className="truncate text-white text-[17px] font-medium tracking-tight">
            {profile?.display_name || profile?.handle || "Du"}
          </div>
          {profile?.display_name && profile.handle && (
            <div className="truncate text-white/35 text-xs">{profile.handle}</div>
          )}
        </div>
        <Link
          to="/settings"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] active:scale-95 transition-transform"
          aria-label="Einstellungen"
        >
          <span className="material-symbols-outlined text-white/60 text-[20px]">settings</span>
        </Link>
      </header>

      <div className="mt-6 px-5">
        <span className="text-[11px] uppercase tracking-[0.4em] text-white/40 font-medium">
          Rücklauf
        </span>
      </div>

      {/* --- Deine Momente ---------------------------------------------- */}
      {seq.step && (
        <div className="mt-4 px-4">
          <div
            className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem]"
            style={{
              // Steht DIESER Moment gerade im Corso, bekommt er denselben weißen
              // Rand wie auf dem Corso-Screen. Beim Blättern durch die eigenen
              // Momente sieht man so sofort, welcher es auf die Bühne geschafft
              // hat (Entscheidung Dominik, 9. Sep 2026).
              boxShadow: stats?.in_city_story
                ? "0 0 0 2px rgba(255,255,255,0.92), 0 0 28px -6px rgba(255,255,255,0.45)"
                : "0 0 0 1px rgba(255,255,255,0.08)",
              transition: "box-shadow 320ms ease",
            }}
            // In-Place-Blättern wie in den Feeds: rechte Hauptfläche = weiter,
            // linkes Drittel = zurück. Hier reicht onClick — der Rücklauf ist
            // kein Snap-Container, es gibt also kein preventDefault, das die
            // click-Ereignisse schluckt (siehe TapInfo in use-snap-scroll.ts).
            onClick={(e) => {
              if (isControlTap(e.target)) return; // Ton-Knopf
              const rect = e.currentTarget.getBoundingClientRect();
              if (tapDirection(e.clientX, e.clientY, rect) === "prev") seq.prev();
              else seq.next();
            }}
          >
            <SequenceMedia
              step={seq.step}
              moment={seq.currentMoment}
              isActive
              isLastStep={seq.isLastStep}
              onEnded={seq.autoNext}
            />

            {/* Fortschritt — dieselbe eine Zeile wie in den Feeds. */}
            {seq.hasSequence && (
              <div className="pointer-events-none absolute inset-x-4 top-3 z-20">
                <MomentProgress groups={seq.groups} stepIndex={seq.stepIndex} />
              </div>
            )}

            {consent && (
              <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-md">
                <span className="material-symbols-outlined text-white/80 text-[14px]">movie</span>
                <span className="text-[11px] font-medium text-white/80">
                  {stats?.in_city_story ? "Im Corso" : "Freigegeben"}
                </span>
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5 pt-14">
              <div className="flex items-end justify-between gap-3">
                <div className="text-[11px] text-white/50">{momentVisibility(stats)}</div>
                {seq.groups.length > 1 && (
                  <div className="shrink-0 text-[11px] text-white/50 tabular-nums">
                    Moment {(seq.step?.momentIndex ?? 0) + 1} von {seq.groups.length}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Moment abgelaufen (oder im Corso, aber per RLS nicht mehr lesbar):
          keine Wiedergabe, nur die eingefrorene Bilanz. */}
      {hasMoment && !seq.step && (
        <div className="mt-4 px-5">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4">
            <div className="flex items-center gap-2 text-white/40">
              <span className="material-symbols-outlined text-[18px]">history</span>
              <span className="text-sm">
                Dein letzter Moment{" "}
                {feedback.moment_created_at && `· ${dayLabel(feedback.moment_created_at)}`}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-snug text-white/25">
              Nach 24 Stunden ist ein Moment überall weg, auch für dich. Seine Bilanz bleibt.
            </p>
          </div>
        </div>
      )}

      {/* --- Gewonnen (Aufstieg) ---------------------------------------- */}
      <section className={`mt-8 px-5 ${!live && hasMoment ? "opacity-60" : ""}`}>
        <SectionLabel>Gewonnen</SectionLabel>

        {feedback.in_city_story && (
          <div className="mt-3 flex items-start gap-3 rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3.5">
            <span className="material-symbols-outlined mt-0.5 text-white text-[20px]">
              auto_awesome
            </span>
            <div>
              <div className="text-white text-sm font-medium tracking-tight">
                Die Stadt hat dich gesehen
              </div>
              <div className="mt-0.5 text-white/45 text-xs">
                Dein Moment steht im heutigen Stadt Corso.
              </div>
            </div>
          </div>
        )}

        {hasMoment ? (
          <div className="mt-5 flex flex-col gap-5">
            <GainMetric
              value={views}
              label="Views"
              sublabel={live ? "haben deinen Moment gesehen" : "haben ihn gesehen"}
              badge={isRecord ? "Rekord" : null}
            />
            <GainMetric
              value={stayed}
              label={stayed === 1 ? "ist geblieben" : "sind geblieben"}
              sublabel="neue Follower durch diesen Moment"
              highlight={stayed > 0}
            />
          </div>
        ) : (
          <p className="mt-3 max-w-[19rem] text-sm leading-snug text-white/30">
            Noch kein Moment. Sobald du einen aufnimmst, steht hier, was er eingebracht hat.
          </p>
        )}
      </section>

      <div className="mx-5 mt-8 h-px bg-white/[0.08]" />

      {/* --- Auf der Kippe (Schwerkraft) -------------------------------- */}
      <section className="mt-7 px-5">
        <SectionLabel>Auf der Kippe</SectionLabel>

        {feedback.followers === 0 ? (
          <p className="mt-3 max-w-[19rem] text-sm leading-snug text-white/30">
            Noch niemand folgt dir. Publikum entsteht, wenn dich jemand in der Discovery oder im
            Stadt Corso sieht.
          </p>
        ) : feedback.at_risk === 0 ? (
          <p className="mt-3 max-w-[19rem] text-sm leading-snug text-white/35">
            Von deinen {feedback.followers} Followern entscheidet gerade niemand neu — die nächsten
            Ablaufzeiten liegen mehr als 12 Stunden entfernt.
          </p>
        ) : (
          <>
            <div className="mt-3 flex items-baseline gap-2.5">
              <span className="text-5xl font-semibold tabular-nums leading-none text-white/70">
                {feedback.at_risk.toLocaleString("de-DE")}
              </span>
              <span className="text-white/35 text-base">
                von {feedback.followers.toLocaleString("de-DE")}
              </span>
            </div>
            <p className="mt-2.5 max-w-[19rem] text-sm leading-snug text-white/40">
              {feedback.at_risk === 1 ? "entscheidet" : "entscheiden"} in den nächsten 12 Stunden
              neu, ob {feedback.at_risk === 1 ? "er dir" : "sie dir"} weiter folgen.
            </p>
          </>
        )}

        {(!live || !hasMoment) && (
          <Link
            to="/record"
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-neutral-950 text-[15px] font-medium active:scale-[0.98] transition-transform"
          >
            <span className="material-symbols-outlined text-[20px]">photo_camera</span>
            Moment aufnehmen
          </Link>
        )}
      </section>

      {/* --- Serie ------------------------------------------------------ */}
      {feedback.streak > 0 && (
        <div className="mt-8 flex items-center gap-2.5 px-5">
          <StreakDots count={feedback.streak} />
          <span className="text-white/40 text-xs">
            {feedback.streak} {feedback.streak === 1 ? "Tag" : "Tage"} in Folge geliefert
          </span>
        </div>
      )}
    </div>
  );
}

// Wie lange DIESER Moment noch steht — bezogen auf den gerade angezeigten,
// nicht mehr pauschal auf den neuesten.
function momentVisibility(s: MomentStats | null | undefined): string {
  if (!s?.moment_expires_at) return "";
  const msLeft = new Date(s.moment_expires_at).getTime() - Date.now();
  if (msLeft <= 0) return s.in_city_story ? "Steht im Stadt Corso" : "Abgelaufen";
  const hours = Math.floor(msLeft / 3_600_000);
  if (hours >= 1) return `noch ${hours} ${hours === 1 ? "Stunde" : "Stunden"} sichtbar`;
  const mins = Math.max(1, Math.floor(msLeft / 60_000));
  return `noch ${mins} Minuten sichtbar`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-[0.32em] text-white/30 font-medium">
      {children}
    </span>
  );
}

// Gewinn-Zahl. Wachstum wird hervorgehoben, Stillstand bleibt still — der Screen
// jubelt bei Zuwachs und schweigt bei Verlust (Entscheidung 19. Aug).
function GainMetric({
  value,
  label,
  sublabel,
  badge = null,
  highlight = false,
}: {
  value: number;
  label: string;
  sublabel: string;
  badge?: string | null;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span
          className={`text-5xl font-semibold tabular-nums leading-none ${
            highlight || value > 0 ? "text-white" : "text-white/45"
          }`}
        >
          {value.toLocaleString("de-DE")}
        </span>
        <span className="text-white text-base font-medium tracking-tight">{label}</span>
        {badge && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white">
            <span className="material-symbols-outlined text-[13px] leading-none">trending_up</span>
            {badge}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-white/35 text-sm">{sublabel}</div>
    </div>
  );
}

// Serie als Punkte statt als Flamme — Bewegung zeigen, ohne Druck aufzubauen.
function StreakDots({ count }: { count: number }) {
  const shown = Math.min(count, 7);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-white/50" />
      ))}
      {count > 7 && <span className="ml-0.5 text-white/40 text-xs">+{count - 7}</span>}
    </div>
  );
}

function Centered({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div
      className="relative flex h-dvh w-full flex-col items-center justify-center bg-neutral-950 px-8 text-center"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}
    >
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
        <span className="material-symbols-outlined text-white/25 text-[36px]">{icon}</span>
      </div>
      <p className="max-w-[16rem] text-sm leading-snug text-white/40">{children}</p>
    </div>
  );
}
