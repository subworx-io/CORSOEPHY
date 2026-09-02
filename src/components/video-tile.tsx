import { useEffect, useRef, useState } from "react";

// Video-Moment im Feed — geteilte Kachel (Gegenstück zu PhotoStackTile):
// autoplay stumm, tippen für Ton, dezenter Lade-Ring bei echtem Warten.
// Extrahiert aus index.tsx (2. Sep 2026), damit Discovery, „Ich folge" und
// Circle dieselbe Video-UX nutzen statt drei lokaler Kopien.

// Ab wann der Lade-Ring erscheint: kurze Puffer beim normalen Wischen sollen
// nicht aufblitzen, nur echtes Warten soll als solches sichtbar sein.
const STALL_INDICATOR_MS = 300;

export function VideoTile({
  src,
  isActive,
  preload = "auto",
}: {
  src: string;
  isActive: boolean;
  // "auto" für den aktiven Moment und seine direkten Nachbarn (Bild liegt bereit,
  // wenn man hinzieht), "metadata" für den Rand des Fensters.
  preload?: "auto" | "metadata";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  // Hat das Element gerade ein Bild (readyState ≥ HAVE_CURRENT_DATA)? Fällt bei
  // `waiting`/`emptied` zurück auf false.
  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);

  // `src` gehört bewusst in die Abhängigkeiten: ein src-Wechsel setzt das Element
  // zurück und PAUSIERT es (Media-Load-Algorithmus). Ohne erneutes play() bliebe der
  // aktive Moment nach einem Refetch als Standbild stehen.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (isActive) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isActive, src]);

  // Anfangszustand aus dem Element lesen — bei einem Cache-Treffer ist das Bild
  // schon da, bevor der erste Event-Handler hängt.
  useEffect(() => {
    const v = ref.current;
    if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setReady(true);
  }, []);

  useEffect(() => {
    if (!isActive || ready) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), STALL_INDICATOR_MS);
    return () => clearTimeout(t);
  }, [isActive, ready]);

  function toggleMute() {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  return (
    <>
      <video
        ref={ref}
        src={src}
        playsInline
        muted
        loop
        preload={preload}
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onPlaying={() => setReady(true)}
        onWaiting={() => setReady(false)}
        onEmptied={() => setReady(false)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Dezenter Lade-Ring — nur wenn der aktive Moment wirklich auf Daten wartet */}
      {stalled && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="h-9 w-9 rounded-full border-2 border-white/15 border-t-white/80 animate-spin" />
        </div>
      )}
      {isActive && (
        <button
          onClick={toggleMute}
          className="absolute top-4 left-4 h-9 w-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform z-10"
          aria-label={muted ? "Ton einschalten" : "Ton ausschalten"}
        >
          <span className="material-symbols-outlined text-white text-[18px]">
            {muted ? "volume_off" : "volume_up"}
          </span>
        </button>
      )}
    </>
  );
}
