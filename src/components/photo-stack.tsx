// Foto-Moment: mehrere Fotos als überlappender Stapel („Prints auf dem Tisch").
// Das aktive Foto liegt obenauf, die nächsten lugen versetzt und leicht gedreht
// darunter hervor. Ein einzelnes Foto füllt die Kachel einfach ganz — kein
// Stapel-Theater um genau ein Bild.
//
// ⚠️ GESTEUERT VON AUSSEN (Umbau 9. Sep 2026): Die Kachel hat KEINEN eigenen
// Index, KEINEN eigenen Timer und KEINEN eigenen Tipp-Handler mehr. Welches Foto
// oben liegt, bestimmt `useMomentSequence` — für den Nutzer sind die Bilder
// gleichberechtigte Schritte in der Sequenz einer Person, nicht eine eigene
// Ebene „innerhalb" eines Moments. Zwei Uhren für dieselbe Bewegung wären sonst
// nicht synchron zu halten (der Fortschrittsbalken zeigt genau diese Schritte).
//
// Wird von Discovery, Corso, „Ich folge", Circle und dem Rücklauf geteilt.

// Leichte, pro Foto stabile Drehungen — der Stapel soll gelegt aussehen, nicht generiert.
const ROTATIONS = [-2.4, 2.1, -1.6, 2.7, -2.0];

export function PhotoStackTile({
  urls,
  index,
}: {
  urls: string[];
  /** Welches Foto liegt oben? Kommt aus useMomentSequence (step.photoIndex). */
  index: number;
}) {
  const count = urls.length;

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
    <div className="absolute inset-0 isolate overflow-hidden">
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

      {/* Kein eigener Blätter-Stand mehr (9. Sep 2026): Den Stand zeigt der EINE
          Fortschrittsbalken oben auf der Kachel (components/moment-progress.tsx).
          Die frühere Punktreihe hier unten war seit dem In-Place-Blättern eine
          zweite Anzeige derselben Sache — mitten im Bild und doppelt. */}
    </div>
  );
}
