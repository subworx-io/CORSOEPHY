// Zentrale, fire-and-forget Event-Instrumentierung (Metrik-Tracking ab Tag 1).
// Bezug: .claude/prds/metrik-tracking.prd.md, Migration 0018_events.sql.
//
// Alle user-initiierten Events laufen über die SECURITY-DEFINER-RPC log_event().
// Der Client übergibt NIE eine User-ID — die DB pinnt sie an auth.uid().
// 🔒 Datensparsamkeit: metadata enthält ausschließlich Referenz-IDs/Enums,
// niemals Clip-Inhalte, Texte oder aggregierte Privatzahlen.

import { supabase } from "@/lib/supabase/client";
import type { EventType } from "@/lib/supabase/types";

/**
 * Ein Event protokollieren — bewusst „fire-and-forget".
 *
 * Tracking ist Nebensache: ein Fehler beim Loggen (nicht eingeloggt, Netz weg,
 * RPC-Ablehnung) darf den Nutzer-Flow NIE blockieren. Deshalb kein throw, kein
 * await-Zwang für den Aufrufer, Fehler werden geschluckt.
 */
export function logEvent(
  eventType: EventType,
  metadata?: Record<string, unknown> | null,
): void {
  void supabase
    .rpc("log_event", { p_event_type: eventType, p_metadata: metadata ?? null })
    .then(
      () => {},
      () => {}, // still schlucken — Tracking darf nie stören
    );
}

// ── app_open-Entprellen ─────────────────────────────────────────────────────
// PRD-Open-Question: „app_open bei jedem Fokus kann viele Zeilen erzeugen".
// Antwort: leichtes clientseitiges Entprellen. Höchstens EIN app_open pro
// APP_OPEN_DEBOUNCE_MS pro Session — so blähen schnelle Fokuswechsel
// (Tab-Wechsel, kurzes Wegdrehen) die Tabelle nicht auf, das Intensitätssignal
// „mehrfach am Tag geöffnet" bleibt aber erhalten.
const APP_OPEN_DEBOUNCE_MS = 5 * 60 * 1000; // 5 Minuten
let lastAppOpenAt = 0;

/**
 * app_open feuern, sofern seit dem letzten mindestens APP_OPEN_DEBOUNCE_MS
 * vergangen sind. Der Aufrufer stellt sicher, dass ein User eingeloggt ist
 * (sonst wirft log_event serverseitig und der Insert wird still verworfen).
 */
export function logAppOpen(): void {
  const now = Date.now();
  if (now - lastAppOpenAt < APP_OPEN_DEBOUNCE_MS) return;
  lastAppOpenAt = now;
  logEvent("app_open");
}
