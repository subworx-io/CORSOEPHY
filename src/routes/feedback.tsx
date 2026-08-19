import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { promptDayLabel } from "@/lib/prompts/prompt-history";
import { CityStoryHitSplash } from "@/components/city-story-hit-splash";
import type { MyFeedback } from "@/lib/supabase/types";

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
  videoUrl: string | null;
  cityStoryConsent: boolean;
  // Der Prompt, zu dem dieser Moment entstanden ist. null, wenn für den Tag keine
  // Historie existiert — dann lieber nichts zeigen als den falschen Prompt.
  promptText: string | null;
  promptDate: string | null;
}

function FeedbackPage() {
  const { user, profile } = useAuth();
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

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

      // Das Video nur, solange der Moment wirklich lebt. Abgelaufene Posts sind
      // per RLS auch für den Autor weg (0015) — der Screen friert dann nur die
      // Zahlen ein, nicht den Moment selbst.
      let videoUrl: string | null = null;
      let consent = false;
      let promptText: string | null = null;
      let promptDate: string | null = null;

      if (feedback.moment_id) {
        const { data: post } = await supabase
          .from("posts")
          .select("media_path, city_story_consent, prompt_date")
          .eq("id", feedback.moment_id)
          .maybeSingle();

        if (post?.media_path) {
          const { data: urlData } = await supabase.storage
            .from("moments")
            .createSignedUrl(post.media_path, 3600);
          videoUrl = urlData?.signedUrl ?? null;
          consent = post.city_story_consent;
          promptDate = post.prompt_date;
        }

        // daily_prompt ist die kanonische Historie. Bewusst KEIN Rückfall auf
        // prompts.active_date — das ist seit 0013 nur ein LRU-Marker.
        if (promptDate) {
          const { data: dp } = await supabase
            .from("daily_prompt")
            .select("prompts (text)")
            .eq("corso_day", promptDate)
            .maybeSingle();
          const joined = (dp as { prompts?: { text?: string } | { text?: string }[] } | null)
            ?.prompts;
          const row = Array.isArray(joined) ? joined[0] : joined;
          promptText = row?.text ?? null;
        }
      }

      return { feedback, videoUrl, cityStoryConsent: consent, promptText, promptDate };
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  useEffect(() => {
    const v = videoRef.current;
    if (v && data?.videoUrl) v.play().catch(() => {});
  }, [data?.videoUrl]);

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
  const hasMoment = !!feedback.moment_id;
  const live = feedback.moment_live;

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

      {/* --- Dein Moment ------------------------------------------------ */}
      {hasMoment && live && data.videoUrl && (
        <div className="mt-4 px-4">
          <div
            className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem]"
            style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}
          >
            <video
              ref={videoRef}
              src={data.videoUrl}
              playsInline
              muted
              loop
              className="absolute inset-0 h-full w-full object-cover"
            />

            <button
              onClick={toggleMute}
              className="absolute top-4 left-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur-md active:scale-95 transition-transform"
              aria-label={muted ? "Ton einschalten" : "Ton ausschalten"}
            >
              <span className="material-symbols-outlined text-white text-[18px]">
                {muted ? "volume_off" : "volume_up"}
              </span>
            </button>

            {data.cityStoryConsent && (
              <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-md">
                <span className="material-symbols-outlined text-white/80 text-[14px]">movie</span>
                <span className="text-[11px] font-medium text-white/80">Freigegeben</span>
              </div>
            )}

            {/* Prompt-Overlay unten — gleiche Optik wie auf allen Feed-Screens */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5 pt-14">
              {data.promptText && data.promptDate && (
                <>
                  <div className="font-serif text-[13px] italic text-white/50">
                    {promptDayLabel(data.promptDate)}
                  </div>
                  <h1 className="mt-0.5 font-serif text-[19px] font-medium leading-[1.2] tracking-[-0.01em] text-white/95">
                    {data.promptText}
                  </h1>
                </>
              )}
              <div className="mt-2 text-[11px] text-white/50">{visibilityLabel(feedback)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Moment abgelaufen (oder im Corso, aber per RLS nicht mehr lesbar):
          keine Wiedergabe, nur die eingefrorene Bilanz. */}
      {hasMoment && (!live || !data.videoUrl) && (
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
              value={feedback.views}
              label="Views"
              sublabel={live ? "haben deinen Moment gesehen" : "haben ihn gesehen"}
              badge={feedback.is_record ? "Rekord" : null}
            />
            <GainMetric
              value={feedback.stayed}
              label={feedback.stayed === 1 ? "ist geblieben" : "sind geblieben"}
              sublabel="neue Follower durch diesen Moment"
              highlight={feedback.stayed > 0}
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

// Wie lange der Moment noch steht. Ein gezogener Moment überlebt seine 24h im
// Stadt Corso (PRD §4.6) — dann ist die Restzeit des Posts irreführend.
function visibilityLabel(f: MyFeedback): string {
  if (!f.moment_expires_at) return "";
  const msLeft = new Date(f.moment_expires_at).getTime() - Date.now();
  if (msLeft <= 0) return f.in_city_story ? "Steht im Stadt Corso" : "Abgelaufen";
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
