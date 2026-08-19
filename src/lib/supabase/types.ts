// Handgepflegte DB-Typen passend zu supabase/migrations/0001_init.sql.
// Bei Schema-Änderungen hier mitziehen (oder später via `supabase gen types` ersetzen).

export interface Profile {
  id: string; // = auth.users.id
  handle: string; // @handle, 1 Gesicht = 1 Handle
  city: string;
  display_name: string | null; // frei editierbarer Anzeigename (optional); Identität bleibt der @handle
  push_enabled: boolean; // Push-Präferenz — nur gespeichert, Push-Logik folgt später
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
  media_path: string; // Pfad im Storage-Bucket 'moments'
  media_type: MediaType;
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

// Rückgabe von city_moment_counts() — aggregierte Stadt-Zahl (Momente heute/gestern),
// Kalendertag in Europe/Berlin. Öffentliches Stimmungsbild, keine personenbezogene Zahl.
export interface CityMomentCounts {
  today: number;
  yesterday: number;
}

// Rückgabe von my_feedback() — die einzige (private) Lese-Oberfläche des Rücklaufs.
// Deltas sind null, solange es kein Gestern gibt (has_yesterday = false).
export interface MyFeedback {
  publikum: number;
  publikum_delta: number | null;
  zuschauer: number;
  zuschauer_delta: number | null;
  has_yesterday: boolean;
}
