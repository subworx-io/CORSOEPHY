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

export interface Prompt {
  id: string;
  active_date: string | null; // Corso-Tag, an dem der Prompt „dran" war; NULL = noch nie benutzt (Kandidat)
  text: string;
  created_at: string;
}

export type MediaType = "photo" | "video";

export interface Post {
  id: string;
  author_id: string;
  prompt_date: string;
  media_path: string; // Pfad im Storage-Bucket 'moments'
  media_type: MediaType;
  city_story_consent: boolean; // 🔒 Einwilligung pro Post
  created_at: string;
}

export interface Follow {
  id: string;
  follower_id: string;
  followee_id: string;
  followed_at: string; // letzter (Re-)Follow → Basis fürs verfallende Herz
  created_at: string;
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

// Rückgabe von my_feedback() — die einzige (private) Lese-Oberfläche des Rücklaufs.
// Deltas sind null, solange es kein Gestern gibt (has_yesterday = false).
export interface MyFeedback {
  publikum: number;
  publikum_delta: number | null;
  zuschauer: number;
  zuschauer_delta: number | null;
  has_yesterday: boolean;
}
