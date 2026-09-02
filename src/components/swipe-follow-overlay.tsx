// Feedback-Schicht für den Swipe-Follow: Während des Wischs blendet ein Herz
// (rechts = folgen/erneuern) bzw. gebrochenes Herz (links = entfolgen) mit dem
// Fortschritt ein. Die CSS-Variablen --swipe-progress / --swipe-progress-left
// setzt use-swipe-follow auf dem Karten-Element. Reine Anzeige, fängt keine
// Gesten. 🔒 Zeigt nur den eigenen Wisch-Fortschritt — keine Zahlen.
export function SwipeFollowOverlay({
  label,
  direction = "right",
}: {
  label: string;
  direction?: "right" | "left";
}) {
  const progressVar = direction === "right" ? "--swipe-progress" : "--swipe-progress-left";
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      style={{ opacity: `var(${progressVar}, 0)` }}
    >
      <div className="flex flex-col items-center gap-2">
        <span
          className="material-symbols-outlined text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
          style={{
            fontSize: "88px",
            fontVariationSettings: "'FILL' 1",
            transform: `scale(calc(0.7 + 0.35 * var(${progressVar}, 0)))`,
          }}
        >
          {direction === "right" ? "favorite" : "heart_broken"}
        </span>
        <span className="text-white text-sm font-semibold tracking-tight drop-shadow-md">
          {label}
        </span>
      </div>
    </div>
  );
}

// Dezenter Hinweis an der Stelle, wo früher der Folgen-Button saß: sagt, dass
// hier gewischt wird. Nicht interaktiv.
export function SwipeHintChip({ label }: { label: string }) {
  return (
    <div className="pointer-events-none flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
      <span
        className="material-symbols-outlined text-white/70 text-[16px] leading-none"
        style={{ fontVariationSettings: "'FILL' 0" }}
      >
        favorite
      </span>
      <span className="text-xs font-medium text-white/70">{label}</span>
      <span className="material-symbols-outlined text-white/70 text-[16px] leading-none">
        arrow_forward
      </span>
    </div>
  );
}
