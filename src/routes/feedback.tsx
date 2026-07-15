import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { MyFeedback } from "@/lib/supabase/types";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "Rücklauf — Corso" },
      {
        name: "description",
        content: "Dein Moment, dein Publikum und deine Reichweite — nur für dich.",
      },
    ],
  }),
  component: FeedbackPage,
});

interface FeedbackData {
  feedback: MyFeedback;
  videoUrl: string | null;
  cityStoryConsent: boolean;
  postedAt: string | null;
}

function FeedbackPage() {
  const { user } = useAuth();
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-feedback", user?.id],
    queryFn: async (): Promise<FeedbackData | null> => {
      if (!user) return null;

      // Die zwei privaten Zahlen + Deltas — RLS-gekapselt (my_feedback ist
      // argumentlos, an auth.uid() gepinnt).
      const { data: rows, error } = await supabase.rpc("my_feedback");
      if (error) return null;
      const feedback =
        (Array.isArray(rows) ? (rows[0] as MyFeedback) : (rows as MyFeedback)) ?? null;
      if (!feedback) return null;

      // Dein aktueller Moment als Hintergrund (neuester eigener Post).
      const { data: post } = await supabase
        .from("posts")
        .select("media_path, city_story_consent, created_at")
        .eq("author_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let videoUrl: string | null = null;
      if (post?.media_path) {
        const { data: urlData } = await supabase.storage
          .from("moments")
          .createSignedUrl(post.media_path, 3600);
        videoUrl = urlData?.signedUrl ?? null;
      }

      return {
        feedback,
        videoUrl,
        cityStoryConsent: post?.city_story_consent ?? false,
        postedAt: post?.created_at ?? null,
      };
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

  // Noch kein Moment: ruhiger Zahlen-Screen ohne Video (Publikum steht trotzdem).
  if (!data.videoUrl) {
    return (
      <div
        className="relative h-dvh w-full bg-neutral-950 flex flex-col"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 3.5rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 7rem)",
        }}
      >
        <div className="px-8">
          <span className="text-[11px] uppercase tracking-[0.4em] text-white/40 font-medium">
            Rücklauf
          </span>
          <p className="mt-2 text-white/30 text-sm leading-snug">
            Dein Stand von heute — nur für dich.
          </p>
        </div>
        <div className="flex-1 flex flex-col justify-center gap-14 px-8">
          <StackedMetric
            value={feedback.publikum}
            delta={feedback.publikum_delta}
            label="Publikum"
            sublabel="folgen dir aktiv"
          />
          <StackedMetric
            value={feedback.zuschauer}
            delta={feedback.zuschauer_delta}
            label="Zuschauer"
            sublabel="haben deinen letzten Moment gesehen"
          />
        </div>
        <div className="px-8">
          <p className="text-white/25 text-xs leading-snug max-w-[18rem]">
            Noch kein Moment — nimm einen auf, dann erscheint er hier als Hintergrund.
            {!feedback.has_yesterday && " Ab morgen siehst du die Veränderung seit gestern."}
          </p>
        </div>
      </div>
    );
  }

  const postedAt = data.postedAt
    ? new Date(data.postedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div
      className="relative h-dvh w-full bg-neutral-950 flex flex-col"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2.5rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
      }}
    >
      {/* Kopf */}
      <div className="px-5 mb-4 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.4em] text-white/40 font-medium">
          Rücklauf
        </span>
        {postedAt && <span className="text-xs text-white/30">{postedAt} Uhr</span>}
      </div>

      {/* Moment als Hintergrund, Zahlen als ruhiges Overlay unten */}
      <div
        className="flex-1 mx-4 relative rounded-[2rem] overflow-hidden"
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

        {/* Ton-Toggle */}
        <button
          onClick={toggleMute}
          className="absolute top-4 left-4 h-9 w-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform z-10"
          aria-label={muted ? "Ton einschalten" : "Ton ausschalten"}
        >
          <span className="material-symbols-outlined text-white text-[18px]">
            {muted ? "volume_off" : "volume_up"}
          </span>
        </button>

        {/* Stadt-Story-Badge */}
        {data.cityStoryConsent && (
          <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-md px-3 py-1.5">
            <span className="material-symbols-outlined text-white/80 text-[14px]">movie</span>
            <span className="text-[11px] text-white/80 font-medium">Stadt-Story freigegeben</span>
          </div>
        )}

        {/* Kennzahlen-Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-5 pt-16 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
          <div className="flex flex-col gap-3.5">
            <OverlayMetric
              value={feedback.publikum}
              delta={feedback.publikum_delta}
              label="Publikum"
            />
            <OverlayMetric
              value={feedback.zuschauer}
              delta={feedback.zuschauer_delta}
              label="Zuschauer"
            />
          </div>
          {!feedback.has_yesterday && (
            <p className="mt-3 text-white/40 text-[11px] leading-snug">
              Dein erster Rücklauf — ab morgen siehst du die Veränderung seit gestern.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Kompakte Zeile fürs Video-Overlay: Zahl · Label · Delta.
function OverlayMetric({
  value,
  delta,
  label,
}: {
  value: number;
  delta: number | null;
  label: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-4xl font-semibold tabular-nums text-white leading-none drop-shadow-md w-[2.2em]">
        {value.toLocaleString("de-DE")}
      </span>
      <span className="text-white text-base font-medium tracking-tight drop-shadow-md">
        {label}
      </span>
      <span className="ml-auto">
        <Delta delta={delta} />
      </span>
    </div>
  );
}

// Große, gestapelte Variante für den Zustand ohne Moment.
function StackedMetric({
  value,
  delta,
  label,
  sublabel,
}: {
  value: number;
  delta: number | null;
  label: string;
  sublabel: string;
}) {
  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="text-6xl font-semibold tabular-nums text-white leading-none">
          {value.toLocaleString("de-DE")}
        </span>
        <span className="pb-1.5">
          <Delta delta={delta} />
        </span>
      </div>
      <div className="mt-3">
        <div className="text-white text-base font-medium tracking-tight">{label}</div>
        <div className="text-white/35 text-sm mt-0.5">{sublabel}</div>
      </div>
    </div>
  );
}

// Delta bewusst neutral — eine sinkende Zahl ist keine Bestrafung, sondern ein
// sachlicher Kontostand. Kein Rot, kein trauriges Icon; nur Richtung + Betrag.
function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return null; // kein Gestern → kein Delta

  if (delta === 0) {
    return (
      <span className="flex items-center gap-1 text-white/45 text-sm">
        <span className="material-symbols-outlined text-[16px] leading-none">remove</span>
        unverändert
      </span>
    );
  }

  const up = delta > 0;
  return (
    <span className="flex items-center gap-0.5 text-white/70 text-sm font-medium tabular-nums">
      <span className="material-symbols-outlined text-[16px] leading-none">
        {up ? "arrow_upward" : "arrow_downward"}
      </span>
      {up ? "+" : "−"}
      {Math.abs(delta).toLocaleString("de-DE")}
    </span>
  );
}

function Centered({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div
      className="relative h-dvh w-full flex flex-col items-center justify-center bg-neutral-950 px-8 text-center"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}
    >
      <div className="w-20 h-20 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center mb-6">
        <span className="material-symbols-outlined text-white/25 text-[36px]">{icon}</span>
      </div>
      <p className="text-white/40 text-sm leading-snug max-w-[16rem]">{children}</p>
    </div>
  );
}
