import { useFollow } from "@/lib/follow-context";
import { supabase } from "@/lib/supabase/client";

/**
 * Einheitlicher Folgen-Button für alle Feeds (Discovery, Story …).
 * 🔒 Zeigt bewusst keine Follower-Zahl — nur den eigenen Folge-Status.
 */
export function FollowButton({
  handle,
  src,
  onBurst,
}: {
  handle: string;
  src: string | null;
  onBurst?: () => void;
}) {
  const { isFollowing, follow } = useFollow();
  const following = isFollowing(handle);

  const handleFollow = async () => {
    if (following) return;
    follow({ handle, src });
    onBurst?.();

    // Followee-Profil per Handle suchen und DB-Row schreiben
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("handle", handle)
      .maybeSingle();
    if (profile) {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      // followed_at + expires_at: null reaktiviert auch abgelaufene Follows per upsert
      await supabase.from("follows").upsert(
        { follower_id: uid, followee_id: profile.id, followed_at: new Date().toISOString(), expires_at: null },
        { onConflict: "follower_id,followee_id" },
      );
    }
  };

  return (
    <button
      onClick={() => void handleFollow()}
      className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-full transition-all active:scale-95 ${
        following
          ? "bg-white text-black"
          : "bg-white/15 backdrop-blur-sm text-white border border-white/30 hover:bg-white/25"
      }`}
    >
      {following ? "folgst du" : "Folgen"}
      <span
        className="material-symbols-outlined text-[16px] leading-none"
        style={{ fontVariationSettings: following ? "'FILL' 1" : "'FILL' 0" }}
      >
        favorite
      </span>
    </button>
  );
}
