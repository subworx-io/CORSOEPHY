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

// Hebel-Kategorien der Prompt-Rotation (0011_prompts_categories.sql), gewichtet ~40/40/20.
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
  prompt_date: string; // Corso-Zyklus (21:00→21:00), in dem der Moment entstand
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

export interface CityStorySlot {
  id: string;
  story_date: string;
  city: string; // Ziehung pro Stadt (Pilot: Düsseldorf)
  post_id: string;
  slot: number; // 0..7
  created_at: string;
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
export interface Connection {
  id: string;
  user_a_id: string; // kanonisch: user_a_id < user_b_id
  user_b_id: string;
  connected_at: string;
  announced_a_at: string | null;
  announced_b_at: string | null;
}

// Chat-Nachricht (0024) — lebt ausschließlich im Circle. RLS: nur die beiden
// Partner der Verbindung lesen/schreiben; Block sperrt serverseitig (Trigger).
export interface CircleMessage {
  id: string;
  connection_id: string;
  sender_id: string;
  body: string;
  created_at: string;
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
//   story_drawn    — nur serverseitig in draw_city_story() geschrieben.
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
