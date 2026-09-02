import { useEffect, useState } from "react";

// Foto-Moment im Feed: mehrere Fotos als überlappender Stapel („Prints auf dem
// Tisch"). Das aktive Foto liegt obenauf, die nächsten lugen versetzt und leicht
// gedreht darunter hervor. Tippen blättert weiter; solange die Kachel aktiv ist,
// blättert der Stapel auch von selbst. Ein einzelnes Foto füllt die Kachel
// einfach ganz — kein Stapel-Theater um genau ein Bild.
//
// Wird von Discovery, Stadt Corso, „Ich folge" und Rücklauf geteilt — gleiche
// Optik überall, wie bei VideoTile.

const ADVANCE_MS = 3000;
// Leichte, pro Foto stabile Drehungen — der Stapel soll gelegt aussehen, nicht generiert.
const ROTATIONS = [-2.4, 2.1, -1.6, 2.7, -2.0];

export function PhotoStackTile({ urls, isActive }: { urls: string[]; isActive: boolean }) {
  const count = urls.length;
  const [index, setIndex] = useState(0);

  // Kachel verlassen → Stapel zurück auf Anfang (wie ein pausiertes Video bei 0).
  useEffect(() => {
    if (!isActive) setIndex(0);
  }, [isActive]);

  // Auto-Weiterblättern nur auf der aktiven Kachel. Timeout statt Interval:
  // ein manueller Tipp setzt die Wartezeit dadurch automatisch zurück.
  useEffect(() => {
    if (!isActive || count <= 1) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [isActive, count, index]);

  if (count === 1) {
    return (
      <img
        src={urls[0]}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }

  return (
    // `isolate`: eigener Stacking-Context. Ohne ihn ragten die z-indizierten
    // Foto-Karten ÜBER die Geschwister-Overlays der Kachel (Handle, Prompt,
    // Folgen-Hinweis) — der Name wirkte „hinter dem Stapel" und war unlesbar.
    <div
      className="absolute inset-0 isolate overflow-hidden"
      onClick={() => setIndex((i) => (i + 1) % count)}
    >
      {/* Grund: das aktive Foto als geblurrte Fläche, damit die Kachel nie leer wirkt */}
      <img
        src={urls[index]}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "blur(28px) brightness(0.45)", transform: "scale(1.2)" }}
      />

      {/* Der Stapel: Position im Stapel = Abstand zum aktiven Foto */}
      {urls.map((url, i) => {
        const depth = (i - index + count) % count;
        const side = i % 2 === 0 ? 1 : -1;
        const transform =
          depth === 0
            ? `rotate(${ROTATIONS[i % ROTATIONS.length] * 0.35}deg)`
            : `translate(${side * 4}%, ${2 + depth * 2.5}%) rotate(${ROTATIONS[i % ROTATIONS.length]}deg) scale(${1 - depth * 0.04})`;
        return (
          <div
            key={url}
            className="absolute inset-[7%] overflow-hidden rounded-2xl"
            style={{
              zIndex: 20 - depth,
              opacity: depth > 2 ? 0 : 1,
              transform,
              transition: "transform 450ms cubic-bezier(0.22, 1, 0.36, 1), opacity 450ms ease",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 18px 50px -12px rgba(0,0,0,0.65)",
            }}
          >
            <img
              src={url}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        );
      })}

      {/* Blätter-Stand — kleine Punkte, keine Zahlen. */}
      <div className="pointer-events-none absolute bottom-[7.5rem] left-0 right-0 z-30 flex justify-center gap-1.5">
        {urls.map((url, i) => (
          <div
            key={url}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === index ? "w-5 bg-white/90" : "w-1.5 bg-white/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
