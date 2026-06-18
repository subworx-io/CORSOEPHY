import { useFollow } from "@/lib/follow-context";

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
  src: string;
  onBurst?: () => void;
}) {
  const { isFollowing, follow } = useFollow();
  const following = isFollowing(handle);

  const handleFollow = () => {
    if (following) return;
    follow({ handle, src });
    onBurst?.();
  };

  return (
    <button
      onClick={handleFollow}
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
