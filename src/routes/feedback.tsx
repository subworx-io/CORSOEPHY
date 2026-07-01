import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "Rücklauf — Corso" },
      { name: "description", content: "Dein heutiger Moment und deine Reichweite." },
    ],
  }),
  component: FeedbackPage,
});

function FeedbackPage() {
  const { user } = useAuth();
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-post", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data: post } = await supabase
        .from("posts")
        .select("id, media_path, city_story_consent, created_at")
        .eq("author_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!post) return null;

      const { data: urlData } = await supabase.storage
        .from("moments")
        .createSignedUrl(post.media_path, 3600);

      const { data: reach } = await supabase.rpc("my_reach");

      return {
        post,
        videoUrl: urlData?.signedUrl ?? null,
        reach: reach ?? 0,
      };
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: true,
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

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950">
        <span className="text-white/30 text-sm animate-pulse">Lädt…</span>
      </div>
    );
  }

  if (!data?.videoUrl) {
    return (
      <div
        className="relative h-dvh w-full flex flex-col items-center justify-center bg-neutral-950 px-8 text-center"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}
      >
        <div className="w-20 h-20 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-white/25 text-[36px]">videocam</span>
        </div>
        <p className="text-white text-lg font-semibold tracking-tight">Noch kein Moment heute</p>
        <p className="mt-2 text-white/40 text-sm leading-snug max-w-[15rem]">
          Nimm einen Clip auf — dann siehst du ihn hier zusammen mit deiner Reichweite.
        </p>
      </div>
    );
  }

  const postedAt = new Date(data.post.created_at).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="relative h-dvh w-full bg-neutral-950 flex flex-col"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2.5rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
      }}
    >
      {/* Header */}
      <div className="px-5 mb-4 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.4em] text-white/40 font-medium">
          Dein Moment
        </span>
        <span className="text-xs text-white/30">{postedAt} Uhr</span>
      </div>

      {/* Video */}
      <div className="flex-1 mx-4 relative rounded-[2rem] overflow-hidden"
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
        >
          <span className="material-symbols-outlined text-white text-[18px]">
            {muted ? "volume_off" : "volume_up"}
          </span>
        </button>

        {/* Stadt-Story-Badge */}
        {data.post.city_story_consent && (
          <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-md px-3 py-1.5">
            <span className="material-symbols-outlined text-white/80 text-[14px]">movie</span>
            <span className="text-[11px] text-white/80 font-medium">Stadt-Story freigegeben</span>
          </div>
        )}

        {/* Reichweite */}
        <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
          <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 font-medium mb-3">
            Reichweite
          </p>
          <div className="flex items-end gap-6">
            <Stat value={data.reach} label="folgen dir" />
            <Stat value="—" label="Pool-Zuschauer" hint="ab Phase 1" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, hint }: { value: number | string; label: string; hint?: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold tabular-nums text-white">{value}</div>
      <div className="text-xs text-white/40 mt-0.5">
        {label}
        {hint && <span className="ml-1 text-white/20">({hint})</span>}
      </div>
    </div>
  );
}
