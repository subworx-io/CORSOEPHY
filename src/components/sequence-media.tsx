import { PhotoStackTile } from "@/components/photo-stack";
import { VideoTile } from "@/components/video-tile";
import type { SequenceMoment, SequenceStep } from "@/hooks/use-moment-sequence";

// Rendert GENAU den Schritt, auf dem die Sequenz gerade steht — Video oder das
// obenauf liegende Foto eines Stapels. Eine Stelle für alle fünf Screens
// (Discovery, Corso, „Ich folge", Circle, Rücklauf), damit gemischte Sequenzen
// überall identisch laufen.
//
// Der Video-Sonderfall steckt hier: `loop` nur für den LETZTEN Schritt. Läuft
// danach noch etwas, muss das Video enden dürfen, damit `onEnded` den nächsten
// Schritt auslöst. Am Ende der Sequenz loopt es weiter — ein Standbild auf dem
// letzten Frame sähe nach Absturz aus, und „am Ende steht die Sequenz" heißt
// nur, dass sie nicht WEITERSPRINGT, nicht dass das Bild einfriert.

export function SequenceMedia({
  step,
  moment,
  isActive,
  isLastStep,
  onEnded,
  preload = "auto",
}: {
  step: SequenceStep;
  /** Der Moment, zu dem der Schritt gehört — trägt die vollständige Fotoliste. */
  moment: SequenceMoment | undefined;
  isActive: boolean;
  isLastStep: boolean;
  /** Auto-Advance nach Ende des Videos. */
  onEnded: () => void;
  preload?: "auto" | "metadata";
}) {
  if (step.isPhoto) {
    const urls = moment?.photoUrls?.length ? moment.photoUrls : [step.url];
    return <PhotoStackTile urls={urls} index={step.photoIndex} />;
  }
  return (
    <VideoTile
      src={step.url}
      isActive={isActive}
      preload={preload}
      loop={isLastStep}
      onEnded={onEnded}
    />
  );
}
