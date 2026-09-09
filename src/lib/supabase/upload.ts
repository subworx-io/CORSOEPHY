import { supabase } from "./client";
import type { Post } from "./types";

// Ein Moment = eine neue posts-Zeile. Bewusst INSERT, nicht UPSERT:
// Seit 0032 darf eine Person mehrere lebende Momente gleichzeitig haben — ein
// neuer Moment stellt sich NEBEN den alten, statt ihn zu ersetzen. Der Grund
// liegt im laufenden Corso: steht ein Moment gerade in einem Slot, soll ein
// neuer Post ihn dort nicht herausreißen. Die 24h-Uhr läuft je Zeile getrennt.
// (Bis 9. Sep 2026 war das ein Upsert auf (author_id, prompt_date) — dieser
// Unique-Key ist mit 0032 gefallen.)

export async function uploadMoment(
  blob: Blob,
  userId: string,
  cityStoryConsent: boolean,
): Promise<{ post: Post | null; error: string | null }> {
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("moments")
    .upload(path, blob, { contentType: blob.type });

  if (uploadError) return { post: null, error: uploadError.message };

  const { data, error: dbError } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      media_path: path,
      media_type: "video",
      media_paths: null, // Video-Moment: keine Foto-Liste
      city_story_consent: cityStoryConsent,
    })
    .select("*")
    .single();

  if (dbError) {
    // Aufräumen: Storage-Objekt entfernen wenn DB-Insert fehlschlägt
    await supabase.storage.from("moments").remove([path]);
    return { post: null, error: dbError.message };
  }

  return { post: data as Post, error: null };
}

/**
 * Foto-Moment: 1–5 Fotos (JPEG aus der Live-Kamera) als EIN Moment.
 * media_path = erstes Foto (Primärpfad für alle bestehenden Lesepfade),
 * media_paths = vollständige geordnete Liste (0023).
 */
export async function uploadPhotoMoment(
  blobs: Blob[],
  userId: string,
  cityStoryConsent: boolean,
): Promise<{ post: Post | null; error: string | null }> {
  if (blobs.length === 0) return { post: null, error: "Kein Foto aufgenommen." };

  const paths = blobs.map(() => `${userId}/${crypto.randomUUID()}.jpg`);

  const uploads = await Promise.all(
    blobs.map((blob, i) =>
      supabase.storage.from("moments").upload(paths[i], blob, { contentType: "image/jpeg" }),
    ),
  );
  const failed = uploads.find((u) => u.error);
  if (failed?.error) {
    // Teilweise hochgeladene Fotos wieder entfernen — kein halber Moment im Storage.
    await supabase.storage.from("moments").remove(paths);
    return { post: null, error: failed.error.message };
  }

  const { data, error: dbError } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      media_path: paths[0],
      media_type: "photo",
      media_paths: paths,
      city_story_consent: cityStoryConsent,
    })
    .select("*")
    .single();

  if (dbError) {
    await supabase.storage.from("moments").remove(paths);
    return { post: null, error: dbError.message };
  }

  return { post: data as Post, error: null };
}
