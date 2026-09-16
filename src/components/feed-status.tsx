// Zustand eines Feeds, solange er (noch) keine Daten hat — eine Stelle für
// Discovery, „Ich folge", Corso und Circle.
//
// Warum es das gibt: Bis 16. Sep 2026 machten die Feed-Abfragen aus einem
// Netzfehler eine leere Liste. Beim Kaltstart oder nach dem Aufwachen in einem
// Funkloch sah man dann „Noch ist niemand draußen" — eine falsche Behauptung —,
// und ein kurzer Aussetzer baute einen laufenden Feed ab. Jetzt werfen die
// Abfragen; TanStack Query behält den letzten guten Stand. Diese Komponente
// deckt nur den Fall ab, dass es noch GAR keinen Stand gibt.
//
//   pending → bewusst leer. Lieber kurz nichts zeigen als etwas Falsches.
//   error   → ehrlicher Hinweis mit „Erneut versuchen".

export function FeedStatus({
  state,
  onRetry,
}: {
  state: "pending" | "error";
  onRetry: () => void;
}) {
  if (state === "pending") return <div className="absolute inset-0" aria-busy="true" />;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/8">
        <span className="material-symbols-outlined text-[36px] text-white/25">wifi_off</span>
      </div>
      <p className="text-lg font-semibold tracking-tight text-white">Keine Verbindung</p>
      <p className="mt-2 max-w-[16rem] text-sm leading-snug text-white/40">
        Die Momente konnten gerade nicht geladen werden.
      </p>
      {/* Echter Button: `isControlTap` nimmt ihn vom Blättern im Feed aus. */}
      <button
        onClick={onRetry}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform active:scale-[0.98]"
      >
        <span className="material-symbols-outlined text-[18px] leading-none">refresh</span>
        Erneut versuchen
      </button>
    </div>
  );
}
