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
