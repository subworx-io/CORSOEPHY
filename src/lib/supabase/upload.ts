import { supabase } from "./client";
import type { Post } from "./types";

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
    .upsert(
      {
        author_id: userId,
        media_path: path,
        media_type: "video",
        // Re-Post im selben Zyklus kann eine Foto-Zeile überschreiben — die alte
        // Foto-Liste darf dann nicht am neuen Video kleben bleiben.
        media_paths: null,
        city_story_consent: cityStoryConsent,
      },
      { onConflict: "author_id,prompt_date" },
    )
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
    .upsert(
      {
        author_id: userId,
        media_path: paths[0],
        media_type: "photo",
        media_paths: paths,
        city_story_consent: cityStoryConsent,
      },
      { onConflict: "author_id,prompt_date" },
    )
    .select("*")
    .single();

  if (dbError) {
    await supabase.storage.from("moments").remove(paths);
    return { post: null, error: dbError.message };
  }

  return { post: data as Post, error: null };
}
