import { supabase } from "@/lib/supabase/client";

// Verbucht eine Ansicht des aktuell aktiven Clips — fire-and-forget. Wird von
// Discovery / Stadt-Story / Ich-folge aufgerufen, sobald ein Clip aktiv wird.
// Die Zählung ist die Datenquelle für "Zuschauer" im Rücklauf (Kill-Metrik).
//
// 🔒 record_view() schreibt serverseitig nur viewer_id = auth.uid() und schließt
//    Self-Views aus; die Zahl selbst ist ausschließlich über my_feedback() lesbar.
//
// Pro Session wird jeder Post nur einmal gemeldet (Netz schonen); die DB ist
// ohnehin idempotent (unique(post_id, viewer_id)).
const reported = new Set<string>();

export function recordView(postId?: string | null) {
  if (!postId || reported.has(postId)) return;
  reported.add(postId);
  void supabase.rpc("record_view", { target_post: postId }).then(({ error }) => {
    // Bei Fehler erneut zulassen, damit ein späterer Versuch greifen kann.
    if (error) reported.delete(postId);
  });
}
