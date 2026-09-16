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
  loop = true,
  onEnded,
  warm = false,
}: {
  src: string;
  isActive: boolean;
  // "auto" für den aktiven Moment und die Kacheln voraus, "metadata" sonst.
  // ⚠️ Auf dem iPhone reicht "auto" allein nicht: Safari lädt ohne Abspielen
  // praktisch nichts vor. Dafür gibt es `warm`.
  preload?: "auto" | "metadata";
  /**
   * Endlos wiederholen? Seit dem In-Place-Blättern (9. Sep 2026) NUR noch für
   * den LETZTEN Schritt einer Sequenz true. Steht danach noch etwas an, muss das
   * Video enden dürfen — sonst käme `onEnded` nie und die Sequenz stünde still.
   */
  loop?: boolean;
  /** Auto-Advance: das Video ist durchgelaufen, der nächste Schritt ist dran. */
  onEnded?: () => void;
  /**
   * Vorwärmen (lib/feed-media-window.ts): Die Kachel liegt kurz voraus. Das
   * Video wird EINMAL stumm angespielt und sofort wieder angehalten, damit das
   * erste Bild dekodiert bereitliegt, wenn man hinwischt.
   */
  warm?: boolean;
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

  // Vorwärmen: einmal pro Quelle. Wird die Kachel währenddessen aktiv, darf das
  // Anhalten nicht mehr greifen — sonst stünde der Moment, den man ansieht.
  const warmedSrcRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  useEffect(() => {
    const v = ref.current;
    if (!v || !warm || isActive || warmedSrcRef.current === src) return;
    warmedSrcRef.current = src;
    v.play()
      .then(() => {
        if (!isActiveRef.current) v.pause();
      })
      .catch(() => {
        // Abspielen verweigert (z. B. Stromsparmodus) — dann eben ohne
        // Vorwärmen. `#t=` an der Quelle sorgt trotzdem für ein erstes Bild.
      });
  }, [warm, isActive, src]);

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
        // `#t=0.001`: Ohne Startmarke zeigt iOS bei preload="metadata" gar kein
        // Bild, bis das Video spielt. Mit ihr dekodiert Safari das erste Frame.
        // Das Fragment geht nie an den Server — die signierte URL bleibt gültig.
        src={`${src}#t=0.001`}
        playsInline
        muted
        loop={loop}
        preload={preload}
        onEnded={onEnded}
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
      {/* Ton-Schalter. Solide Fläche statt backdrop-blur: Ein Backdrop-Filter auf
          einem Element, das mit der Kachel mitwandert, zwingt Safari, den
          Untergrund in jedem Frame neu zu filtern — der teuerste Einzelposten auf
          einer bewegten Kachel. Über einem Video ist ohnehin kaum zu sehen, was
          er tut. */}
      {isActive && (
        <button
          onClick={toggleMute}
          className="absolute top-4 left-4 h-9 w-9 rounded-full bg-black/60 flex items-center justify-center active:scale-95 transition-transform z-10"
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
