import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Handle → Pfad-Segment für die Profil-Route (/p/$handle).
 *
 * Bewusst OHNE das führende @: ein unkodiertes „@" im Pfad wird von Cloudflare
 * Pages mit 404 beantwortet (in-App kodiert TanStack es zu %40, eine getippte
 * oder geteilte URL scheitert aber). `/p/dominik` ist lesbar, teilbar und
 * eindeutig — die Route setzt das @ beim Nachschlagen wieder davor und
 * akzeptiert weiterhin beide Schreibweisen.
 */
export function handleParam(handle: string): string {
  return handle.replace(/^@/, "");
}

/**
 * Gehört dieser Tipp einem Bedienelement (Ton-Knopf, Menü, Link) statt der
 * Kachel? Dann darf der Kachel-Tipp nicht zusätzlich feuern.
 */
export function isControlTap(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el?.closest("button, a, input, [role='button'], [data-no-tile-tap]");
}

// ── Tipp-Zonen der Sequenz-Navigation (Entscheidung Dominik, 9. Sep 2026) ────
// Rechte Hauptfläche = weiter, linkes Drittel = zurück.
/** Anteil der Breite links, der als „zurück" gilt. */
export const TAP_BACK_FRACTION = 1 / 3;
/**
 * Oberer Streifen, in dem NIE zurückgeblättert wird. Dort sitzen der
 * Fortschrittsbalken und der Ton-Knopf (oben links) — ohne diesen Schutz wäre
 * der Ton-Knopf von einer Rückwärts-Zone umzingelt und zur Fummelei geworden.
 */
export const TAP_TOP_GUARD_PX = 96;

/** Wohin führt ein Tipp an dieser Stelle? Rechteck = der Kachel-Container. */
export function tapDirection(x: number, y: number, rect: DOMRect): "prev" | "next" {
  if (y - rect.top < TAP_TOP_GUARD_PX) return "next";
  return (x - rect.left) / rect.width < TAP_BACK_FRACTION ? "prev" : "next";
}
