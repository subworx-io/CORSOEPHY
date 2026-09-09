// Handgepflegte DB-Typen passend zu supabase/migrations/0001_init.sql.
// Bei Schema-Änderungen hier mitziehen (oder später via `supabase gen types` ersetzen).

export interface Profile {
  id: string; // = auth.users.id
  handle: string; // @handle, 1 Gesicht = 1 Handle
  city: string;
  display_name: string | null; // frei editierbarer Anzeigename (optional); Identität bleibt der @handle
  push_enabled: boolean; // Push-*Absicht* des Nutzers; die Geräte-Erlaubnis liegt in push_subscriptions
  created_at: string;
}

// ⚠️ ÜBERHOLT seit dem laufenden Corso (9. Sep 2026): Es gibt keinen Tages-Prompt
// mehr. Die Tabellen `prompts` / `daily_prompt` bleiben in der DB liegen (Pilot-
// Historie, nichts wird gelöscht), der Client liest sie nicht mehr. Die Typen
// stehen hier nur noch, damit die Historie später auswertbar bleibt.
export type PromptCategory = "zeig" | "augenzwinkern" | "funken";

export interface Prompt {
  id: string;
  active_date: string | null; // seit 0013 nur noch LRU-Marker („zuletzt gelaufen"), NICHT der Tages-Schlüssel
  text: string;
  category: PromptCategory | null; // NULL = Alt-Prompt, wird nie gezogen
  active: boolean; // aus der Rotation genommen ohne Löschen (Audit bleibt heil)
  created_at: string;
}

// Kanonische Historie: welcher Prompt lief an welchem Corso-Tag (genau eine Zeile pro Tag).
// Die einzige verlässliche Quelle, um einem Post seinen Prompt zuzuordnen.
export interface DailyPrompt {
  corso_day: string;
  prompt_id: string;
  category: PromptCategory | null;
  created_at: string;
}

export type MediaType = "photo" | "video";

export interface Post {
  id: string;
  author_id: string;
  // Corso-Zyklus (21:00→21:00), in dem der Moment entstand. Seit dem Wegfall des
  // Prompts (9. Sep 2026) nur noch eine Zeit-Gruppierung für die Auswertung —
  // kein Anzeige-Bezug mehr. Der Unique-Key (author_id, prompt_date) ist mit 0032
  // gefallen: eine Person darf mehrere lebende Momente haben.
  prompt_date: string;
  media_path: string; // Pfad im Storage-Bucket 'moments' (bei Fotos: das erste Foto)
  media_type: MediaType;
  // Foto-Momente (0023): vollständige, geordnete Foto-Liste (inkl. media_path),
  // max. 5. Bei Videos NULL.
  media_paths: string[] | null;
  city_story_consent: boolean; // 🔒 Einwilligung pro Post
  created_at: string;
  // Lebensende des Moments: created_at + 24h, per DB-Trigger erzwungen (0015).
  // Lebend = expires_at > now(). Wird NIE vom Client gesetzt.
  expires_at: string;
}

export interface Follow {
  id: string;
  follower_id: string;
  followee_id: string;
  followed_at: string; // letzter (Re-)Follow → Basis fürs verfallende Herz
  created_at: string;
  // followed_at + 24h, per DB-Trigger erzwungen (0015). Aktiv = expires_at > now().
  // ⚠️ Vor 0015 bedeutete NULL „aktiv" — diese Semantik gilt NICHT mehr.
  expires_at: string;
}

// Ein Web-Push-Abo = ein Gerät/Browser, nicht ein Mensch (0016).
// 🔒 Nur für den eigenen Nutzer lesbar; der endpoint ist ein Geräte-Identifikator.
export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string; // Push-Dienst-Endpunkt (Apple/Google/Mozilla), global eindeutig
  p256dh: string; // Schlüssel für die Nutzlast-Verschlüsselung (RFC 8291)
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string; // vom Client bei jedem Start aufgefrischt
  failure_count: number; // aufeinanderfolgende Zustellfehler
}

export interface Nudge {
  id: string;
  nudger_id: string;
  nudged_id: string;
  nudge_date: string;
  created_at: string;
}

// ⚠️ HISTORIE: die eingefrorenen 21:00-Ziehungen bis zum 8. Sep 2026.
// Seit 0031 schreibt nichts mehr hinein — der laufende Corso lebt in corso_slots.
export interface CityStorySlot {
  id: string;
  story_date: string;
  city: string; // Ziehung pro Stadt (Pilot: Düsseldorf)
  post_id: string;
  slot: number; // 0..7
  created_at: string;
}

// Der laufende Corso (0031): eine Zeile = eine Belegung eines Slots durch einen
// Moment. `left_at === null` heißt „steht gerade auf der Bühne". Die Tabelle hat
// bewusst KEINEN Client-Lesepfad — gelesen wird über corso_now() /
// corso_latest_entry(). Der Typ dient der Dokumentation des Schemas.
export interface CorsoSlot {
  id: string;
  city: string;
  slot: number; // 0 .. corso_slot_count-1 (app_config, Default 10)
  post_id: string;
  author_id: string;
  entered_at: string;
  left_at: string | null; // gesetzt, wenn der Moment seine 24h erreicht hat
}

// Rückgabezeile von corso_now() — 🔒 nur Anzeigedaten, keine Zahlen.
export interface CorsoNowRow {
  slot: number;
  handle: string;
  media_path: string;
  media_type: MediaType;
  media_paths: string[] | null;
  post_id: string;
  author_id: string;
  entered_at: string;
}

export interface ReachSnapshot {
  id: string;
  user_id: string;
  snapshot_date: string;
  follower_count: number;
  pool_viewers: number;
  created_at: string;
}

export interface PostView {
  id: string;
  post_id: string;
  viewer_id: string;
  created_at: string;
}

// Melde-Gründe (0016_report_block.sql, reports.reason check). reports selbst wird nie
// clientseitig gelesen (write-only via report_content()) → kein Interface nötig.
export type ReportReason = "inappropriate" | "harassment" | "spam" | "other";

// Block-Zeile (0016). Nur der Blocker liest eigene Zeilen (RLS blocks_read_own).
export interface Block {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

// Circle-Verbindung (0003 Schema, befüllt seit 0024): beständig, gegenseitig,
// verfällt NIE. Entsteht serverseitig (Trigger), wenn sich zwei Menschen an
// genug Corso-Tagen gegenseitig gefolgt sind — die Schwelle ist bewusst nicht
// clientseitig abfragbar (app_config + follow_mutual_days sind ohne Lesepfad).
// announced_*_at: hat die jeweilige Seite die Circle-Ankündigung gesehen
// (serverseitig pro Person, gesetzt via RPC acknowledge_circle()).
// last_read_*_at (0028): Lese-Stand der jeweiligen Seite im Chat — serverseitig
// statt localStorage, damit „ungelesen" auf allen Geräten dasselbe heißt.
// Schreibbar ausschließlich über RPC mark_circle_read() (connections hat keine
// UPDATE-Policy), und nur für die eigene Seite.
export interface Connection {
  id: string;
  user_a_id: string; // kanonisch: user_a_id < user_b_id
  user_b_id: string;
  connected_at: string;
  announced_a_at: string | null;
  announced_b_at: string | null;
  last_read_a_at: string | null;
  last_read_b_at: string | null;
}

// Chat-Nachricht (0024) — lebt ausschließlich im Circle. RLS: nur die beiden
// Partner der Verbindung lesen/schreiben; Block sperrt serverseitig (Trigger).
// Seit 0028 in der supabase_realtime-Publication: neue Nachrichten kommen per
// Realtime an, nicht mehr per Polling.
/** Sorte einer Chat-Nachricht (0035). 'text' = ohne Anhang. */
export type ChatMessageKind = "text" | "photo" | "video" | "voice";

export interface CircleMessage {
  id: string;
  connection_id: string;
  sender_id: string;
  /** Bei reinen Medien-Nachrichten leer — der Check erlaubt das seit 0035. */
  body: string;
  created_at: string;
  // ── Anhang (0035). Chat-Medien liegen im PRIVATEN Bucket `chat-media`,
  // Pfad <connection_id>/<sender_id>/<uuid>. 🔒 Nur die beiden Partner der
  // Verbindung bekommen dafür eine signierte URL — durchgesetzt per
  // Storage-Policy, nicht im Client.
  kind: ChatMessageKind;
  attachment_path: string | null;
  attachment_mime: string | null;
  attachment_bytes: number | null;
  /** Video und Sprachnachricht. */
  duration_ms: number | null;
  /** Foto/Video — für das Seitenverhältnis der Blase. */
  width: number | null;
  height: number | null;
  /** Zitierte Nachricht. Serverseitig auf dieselbe Verbindung beschränkt (0035). */
  reply_to: string | null;
}

/** Spaltenliste für jede circle_messages-Abfrage — muss vollständig bleiben:
 *  Realtime liefert die GANZE Zeile, eine kürzere Auswahl erzeugt sonst zwei
 *  verschiedene Zeilenformen im selben Query-Cache. */
export const CIRCLE_MESSAGE_COLUMNS =
  "id, connection_id, sender_id, body, created_at, kind, attachment_path, attachment_mime, attachment_bytes, duration_ms, width, height, reply_to";

// Rückgabe von circle_inbox() (0028) — eine Zeile je eigener Verbindung mit der
// jüngsten Nachricht und dem Ungelesen-Stand. 🔒 Bewusst ohne Zähler: die App
// zeigt einen Punkt, keine Zahl.
export interface CircleInboxRow {
  connection_id: string;
  partner_id: string;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread: boolean;
}

// Rückgabe von city_moment_counts() — aggregierte Stadt-Zahl (Momente heute/gestern),
// Kalendertag in Europe/Berlin. Öffentliches Stimmungsbild, keine personenbezogene Zahl.
export interface CityMomentCounts {
  today: number;
  yesterday: number;
}

// Rückgabe von my_feedback() — die einzige (private) Lese-Oberfläche des Rücklaufs.
// Seit 0017 entlang der zwei Kräfte (PRD §1): was der laufende Moment eingebracht
// hat (views/stayed/in_city_story) und was verfällt, wenn nichts nachkommt (at_risk).
// Kein „seit gestern"-Delta mehr — der Bezugsrahmen ist der Moment, nicht der Zyklus.
export interface MyFeedback {
  followers: number;
  views: number;
  stayed: number;
  at_risk: number;
  moment_id: string | null;
  moment_live: boolean;
  moment_created_at: string | null;
  moment_expires_at: string | null;
  // ⚠️ Seit dem laufenden Corso (0031) endet eine Corso-Belegung exakt mit den
  // 24h des Moments — die frühere Lebensverlängerung „im Corso, aber abgelaufen"
  // (PRD §4.6, bis zu 48h) ist gestrichen. Das Feld bleibt korrekt: „steht mein
  // Moment gerade im Corso?".
  in_city_story: boolean;
  is_record: boolean;
  streak: number;
}

// Kanonische Event-Typen des Metrik-Logs (0018_events.sql). Muss exakt zum
// event_type-Check der Tabelle + zur Validierung in log_event() passen.
// events ist write-only (RLS ohne Lese-Policy) → kein Row-Interface nötig,
// clientseitig wird nur dieser Union als RPC-Argument gebraucht.
//   follow_expired — reserviert, wird NICHT gefeuert (Verfall implizit über
//                    follows.expires_at seit 0015, kein Cron mehr).
//   chat_reached   — reserviert (Phase 3, Chat existiert nicht).
//   story_drawn    — nur serverseitig geschrieben: bis 8. Sep in draw_city_story(),
//                    seit 0031 in refill_corso() (metadata.via = 'corso_refill')
//                    bei jedem Einzug in einen Corso-Slot.
//   onboarding_completed — First-Run abgeschlossen (metadata.via: "read"|"skip").
export type EventType =
  | "app_open"
  | "moment_posted"
  | "follow_set"
  | "follow_expired"
  | "story_viewed"
  | "nudge_sent"
  | "chat_reached"
  | "story_drawn"
  | "onboarding_completed";
