import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";
import { HapticTapTarget } from "@/components/haptic-tap";

// Foto-Sichtung im Aufnahme-Screen (Backlog #24/#25, Entscheidung Dominik
// 4. Sep 2026): Wer einen Stapel geknipst hat, will die Bilder GROSS sehen,
// bevor der Moment rausgeht — und dort auch aussortieren.
//
// Damit wandert das Löschen aus dem Thumbnail-Streifen hierher. Die × an den
// Thumbnails sind ersatzlos weg: bei fünf Fotos überlappten sie sich gegenseitig
// und waren als 20-px-Kreis ohnehin kaum zu treffen. Ein Foto zum Wegwerfen
// auszuwählen, ohne es vorher richtig gesehen zu haben, war sowieso die falsche
// Reihenfolge.
//
// Blättern über CSS-Scroll-Snap statt eigener Gestenlogik: Der Viewer ist ein
// kurzlebiges Overlay über der Kamera, nicht der Feed. Native Trägheit ist hier
// besser als alles, was wir nachbauen würden — und der Feed-Snap (use-snap-scroll)
// bleibt der eine Ort, an dem Corso Gesten selbst rechnet.

export function PhotoReview({
  photos,
  initialIndex,
  onRemove,
  onClose,
}: {
  photos: { url: string }[];
  /** Angetipptes Foto — dort geht der Viewer auf. */
  initialIndex: number;
  onRemove: (index: number) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollToIndex = useCallback((i: number) => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "auto" });
  }, []);

  // Beim Öffnen an die angetippte Stelle springen — ohne Animation, der Viewer
  // soll dort aufgehen, wo der Finger war.
  useEffect(() => {
    scrollToIndex(initialIndex);
    // Nur beim Mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nach dem Löschen nachziehen. Über die Länge gesteuert und nicht über den
  // Index: ein Effect, der bei JEDER Index-Änderung scrollt, würde dem Finger
  // mitten in der Wischbewegung in die Parade fahren.
  const lengthRef = useRef(photos.length);
  useEffect(() => {
    if (lengthRef.current === photos.length) return;
    lengthRef.current = photos.length;
    if (photos.length === 0) {
      onClose();
      return;
    }
    const next = Math.min(index, photos.length - 1);
    setIndex(next);
    scrollToIndex(next);
  }, [photos.length, index, onClose, scrollToIndex]);

  // Blätterstand aus der Scroll-Position ablesen (nur lesend — hier wird nie
  // zurückgescrollt, sonst kämpfen Finger und Effect gegeneinander).
  const handleScroll = () => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index && i >= 0 && i < photos.length) setIndex(i);
  };

  const remove = () => {
    haptic("warning");
    onRemove(index);
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black">
      {/* Kopf: Blätterstand + Schließen */}
      <header
        className="flex shrink-0 items-center justify-between px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <span className="text-[13px] font-medium tabular-nums text-white/60">
          Foto {index + 1} von {photos.length}
        </span>
        <span className="relative inline-flex">
          <HapticTapTarget label="Sichten beenden" onTap={onClose} />
          <button
            onClick={onClose}
            aria-label="Sichten beenden"
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black transition-transform active:scale-95"
          >
            Fertig
          </button>
        </span>
      </header>

      {/* Die Bilder — ein Snap-Punkt je Foto, `object-contain`: hier wird
          gesichtet, nicht zugeschnitten. Im Feed füllt derselbe Moment später
          formatfüllend (PhotoStackTile), das ist eine andere Frage. */}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {photos.map((photo) => (
          <div key={photo.url} className="relative h-full w-full shrink-0 snap-center">
            <img
              src={photo.url}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>
        ))}
      </div>

      {/* Fuß: Blätter-Punkte + Papierkorb */}
      <div
        className="flex shrink-0 flex-col items-center gap-4 px-4 pt-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
      >
        {photos.length > 1 && (
          <div className="flex items-center justify-center gap-1.5">
            {photos.map((photo, i) => (
              <span
                key={photo.url}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? "w-5 bg-white/90" : "w-1.5 bg-white/35"
                }`}
              />
            ))}
          </div>
        )}

        <span className="relative inline-flex">
          <HapticTapTarget label="Foto verwerfen" onTap={remove} />
          <button
            onClick={remove}
            aria-label={`Foto ${index + 1} verwerfen`}
            className="flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-[13px] font-medium text-white/85 transition-transform active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">delete</span>
            Verwerfen
          </button>
        </span>
      </div>
    </div>
  );
}
