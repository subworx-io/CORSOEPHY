import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Die Sequenz eines Menschen — EINE flache, lineare Vorwärtsbewegung.
// (Umbau 9. Sep 2026, Entscheidung Dominik.)
//
// GRUNDPRINZIP: Für den Nutzer gibt es KEINE verschachtelten Ebenen
// „Bilder in Moment in Person". Es gibt einen durchgehenden Fluss:
//
//   Moment 1 (Video) → Moment 2, Bild 1 → Bild 2 → … → Bild 5 → Moment 3 → Ende
//
// Ein Tipp geht immer genau einen Schritt weiter, egal ob der nächste Schritt
// das nächste Bild derselben Reihe oder der nächste Moment ist. Es öffnet sich
// dabei NIE eine Zwischenebene — alles passiert in der Ansicht, in der man
// gerade ist (Discovery, Ich-folge, Corso, Rücklauf).
//
// ZWEI ARTEN VON „WEITER", bewusst unterschiedlich (Entscheidung Dominik):
//   - `next()`   = Tipp. Am Ende der Sequenz ruft er `onExhausted` → der Feed
//                  springt nahtlos zur nächsten Person. Kein Loop.
//   - Auto-Advance = läuft NUR innerhalb der Sequenz. Am Ende bleibt es stehen;
//                  es reißt einen nicht ungefragt zur nächsten Person weiter.
//
// AUTO-ADVANCE JE MEDIUM:
//   - Bild: nach PHOTO_ADVANCE_MS (3 s, unverändert aus dem alten Foto-Stapel).
//   - Video: KEIN Timer — das Video meldet sich selbst über `onEnded`. Deshalb
//     darf ein Video nur noch dann `loop` tragen, wenn es der LETZTE Schritt
//     ist; sonst liefe es endlos und die Sequenz stünde für immer still.
//     Genau dafür gibt es `isLastStep` in der Rückgabe.

/** Dauer eines Bildes, bevor automatisch weitergeblättert wird. */
export const PHOTO_ADVANCE_MS = 3000;

export interface SequenceMoment {
  postId: string;
  authorId: string;
  /** Genau eines von beiden ist gesetzt. */
  videoUrl?: string | null;
  photoUrls?: string[] | null;
  createdAt?: string | null;
}

/** Ein einzelner Schritt der flachen Sequenz. */
export interface SequenceStep {
  /** Index des Moments innerhalb der Person (0-basiert). */
  momentIndex: number;
  /** Index des Bildes innerhalb des Moments; bei Video immer 0. */
  photoIndex: number;
  postId: string;
  authorId: string;
  isPhoto: boolean;
  url: string;
  createdAt?: string | null;
}

/** Wie viele Schritte gehören zu welchem Moment — Grundlage des Balkens. */
export interface SequenceGroup {
  postId: string;
  stepCount: number;
  /** Index des ersten Schritts dieser Gruppe in der flachen Liste. */
  firstStep: number;
}

function buildSteps(moments: SequenceMoment[]): SequenceStep[] {
  const steps: SequenceStep[] = [];
  moments.forEach((m, momentIndex) => {
    const urls = m.photoUrls?.length ? m.photoUrls : m.videoUrl ? [m.videoUrl] : [];
    const isPhoto = !!m.photoUrls?.length;
    urls.forEach((url, photoIndex) => {
      steps.push({
        momentIndex,
        photoIndex,
        postId: m.postId,
        authorId: m.authorId,
        isPhoto,
        url,
        createdAt: m.createdAt,
      });
    });
  });
  return steps;
}

/**
 * Erster Schritt einer Sequenz — für Kacheln, die gerade NICHT aktiv sind.
 * Nachbar-Kacheln blitzen beim Wischen auf; sie zeigen den Anfang der Person,
 * nicht die Stelle, an der jemand anderes stehengeblieben ist.
 */
export function firstStepOf(moments: SequenceMoment[]): {
  step: SequenceStep | undefined;
  moment: SequenceMoment | undefined;
} {
  const step = buildSteps(moments)[0];
  return { step, moment: step ? moments[step.momentIndex] : undefined };
}

export function useMomentSequence({
  moments,
  isActive,
  onExhausted,
  initialMomentIndex = 0,
}: {
  moments: SequenceMoment[];
  /** Nur die sichtbare Kachel blättert automatisch weiter. */
  isActive: boolean;
  /** Tipp auf den LETZTEN Schritt — der Feed geht zur nächsten Person. */
  onExhausted?: () => void;
  /**
   * Startpunkt. Der Corso beginnt beim Moment, der tatsächlich auf der Bühne
   * steht — nicht zwangsläufig beim ältesten.
   */
  initialMomentIndex?: number;
}) {
  const steps = useMemo(() => buildSteps(moments), [moments]);

  const groups = useMemo<SequenceGroup[]>(() => {
    const out: SequenceGroup[] = [];
    steps.forEach((s, i) => {
      const last = out[out.length - 1];
      if (last && last.postId === s.postId) last.stepCount += 1;
      else out.push({ postId: s.postId, stepCount: 1, firstStep: i });
    });
    return out;
  }, [steps]);

  // Startschritt = erster Schritt des gewünschten Moments.
  const startStep = useMemo(() => {
    const i = steps.findIndex((s) => s.momentIndex === initialMomentIndex);
    return i >= 0 ? i : 0;
  }, [steps, initialMomentIndex]);

  const [index, setIndex] = useState(startStep);

  // Kachel verlassen → zurück auf den Start (wie der alte Foto-Stapel: eine
  // Kachel, die man wieder betritt, fängt vorne an statt mitten drin).
  useEffect(() => {
    if (!isActive) setIndex(startStep);
  }, [isActive, startStep]);

  // Wechselt die Sequenz selbst (Refetch, andere Person auf demselben Slot),
  // darf der alte Index nicht stehenbleiben und ins Leere zeigen.
  const stepKey = steps.map((s) => s.postId + ":" + s.photoIndex).join("|");
  const lastKeyRef = useRef(stepKey);
  useEffect(() => {
    if (lastKeyRef.current !== stepKey) {
      lastKeyRef.current = stepKey;
      setIndex(startStep);
    }
  }, [stepKey, startStep]);

  const clamped = Math.min(index, Math.max(0, steps.length - 1));
  const atEnd = clamped >= steps.length - 1;
  const atStart = clamped <= 0;

  const onExhaustedRef = useRef(onExhausted);
  onExhaustedRef.current = onExhausted;

  /** Tipp „weiter". Am Ende: raus aus der Person. */
  const next = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        onExhaustedRef.current?.();
        return i;
      }
      return i + 1;
    });
  }, [steps.length]);

  /** Tipp „zurück". Am Anfang: bleibt stehen (kein Sprung zur Person davor). */
  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  /**
   * Automatisch weiter — im Gegensatz zu `next()` OHNE Sprung zur nächsten
   * Person. Am Ende der Sequenz bleibt es stehen (Entscheidung Dominik).
   */
  const autoNext = useCallback(() => {
    setIndex((i) => (i >= steps.length - 1 ? i : i + 1));
  }, [steps.length]);

  const step: SequenceStep | undefined = steps[clamped];
  /** Der Moment, zu dem der aktuelle Schritt gehört — für den Foto-Stapel-Look. */
  const currentMoment: SequenceMoment | undefined =
    step === undefined ? undefined : moments[step.momentIndex];

  // Auto-Advance für BILDER. Timeout statt Interval: ein manueller Tipp setzt
  // die Wartezeit dadurch automatisch zurück (index ist in den Abhängigkeiten).
  useEffect(() => {
    if (!isActive || !step?.isPhoto || atEnd) return;
    const id = window.setTimeout(autoNext, PHOTO_ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [isActive, step?.isPhoto, step?.url, clamped, atEnd, autoNext]);

  return {
    steps,
    groups,
    currentMoment,
    /** Aktueller Schritt; undefined nur, wenn die Person gar nichts Lebendes hat. */
    step,
    stepIndex: clamped,
    atStart,
    atEnd,
    next,
    prev,
    /** Für `<video onEnded>` — Auto-Advance, kein Personenwechsel. */
    autoNext,
    /**
     * Nur der letzte Schritt darf ein Video loopen lassen. Sonst müsste das
     * Video enden, damit die Sequenz weiterläuft.
     */
    isLastStep: atEnd,
    /** Balken und Tipp-Navigation nur zeigen/aktivieren, wenn es was zu blättern gibt. */
    hasSequence: steps.length > 1,
  };
}
