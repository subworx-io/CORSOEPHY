import type { SequenceGroup } from "@/hooks/use-moment-sequence";

// Der Fortschrittsbalken der Sequenz einer Person (Instagram-Muster).
//
// EINE einzige Zeile für ALLES (Entscheidung Dominik, 9. Sep 2026) — bewusst
// nicht zwei Reihen und auch keine zweite Anzeige irgendwo sonst auf der Kachel.
//
// JEDER MOMENT IST GLEICH BREIT (Entscheidung Dominik, 9. Sep 2026, abends):
//
//   ▬▬▬▬▬▬   ● ● ● ● ●   ▬▬▬▬▬▬
//   Moment    Bilderreihe   Moment
//
// Ein Moment mit einem Schritt ist ein Balken, eine Bilderreihe wird zu ebenso
// vielen PUNKTEN — die zusammen exakt die Breite eines Balkens einnehmen. Vorher
// war jeder Schritt gleich breit; eine Fünfer-Reihe fraß damit fünfmal so viel
// Platz wie ein Video und ließ die Zeile aussehen, als hätte die Person sieben
// Momente. Punkte lesen sich als „gehört zusammen, ist eine Reihe" und kosten
// kaum Breite.

const GAP_BETWEEN = "7px"; // zwischen zwei Momenten
const GAP_DOTS = "3px"; // zwischen den Punkten einer Bilderreihe

const DONE = "rgba(255,255,255,0.95)";
const PENDING = "rgba(255,255,255,0.28)";

export function MomentProgress({
  groups,
  stepIndex,
  className = "",
}: {
  groups: SequenceGroup[];
  /** Aktueller Schritt in der FLACHEN Sequenz. */
  stepIndex: number;
  className?: string;
}) {
  // Ein einzelner Schritt hat keinen Fortschritt zu zeigen.
  const total = groups.reduce((n, g) => n + g.stepCount, 0);
  if (total <= 1) return null;

  return (
    <div
      className={`pointer-events-none flex h-1.5 items-center ${className}`}
      style={{ gap: GAP_BETWEEN }}
      aria-hidden
    >
      {groups.map((group) => {
        // Alle Gruppen gleich breit — unabhängig davon, wie viele Bilder drin sind.
        const shared = { flexGrow: 1, flexBasis: 0 } as const;

        if (group.stepCount === 1) {
          return (
            <div
              key={group.postId}
              className="h-0.5 rounded-full transition-colors duration-200"
              style={{
                ...shared,
                background: group.firstStep <= stepIndex ? DONE : PENDING,
              }}
            />
          );
        }

        return (
          <div
            key={group.postId}
            className="flex items-center justify-center"
            style={{ ...shared, gap: GAP_DOTS }}
          >
            {Array.from({ length: group.stepCount }, (_, i) => {
              const absolute = group.firstStep + i;
              return (
                <div
                  key={absolute}
                  className="h-1 w-1 shrink-0 rounded-full transition-colors duration-200"
                  style={{ background: absolute <= stepIndex ? DONE : PENDING }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
