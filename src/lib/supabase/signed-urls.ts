import { supabase } from "@/lib/supabase/client";

// Signierte Lese-URLs für den Bucket `moments` — gebündelt und gecacht.
//
// Warum ein Cache: Jeder Aufruf von createSignedUrl() liefert ein NEUES Token.
// Ein Refetch (Rückkehr auf den Screen, App-Wechsel) tauschte bisher das `src`
// jedes <video> aus → der Browser lädt den Clip von vorn und pausiert das
// laufende Video (Media-Load-Algorithmus). Gleiche URL = kein Reload, und der
// HTTP-Cache greift auch für Slides, die aus dem Render-Fenster fallen.
//
// Warum gebündelt: eine Seite Discovery zog 20 einzelne Sign-Requests, bevor
// die erste Kachel stand. createSignedUrls() macht daraus einen Request.

const BUCKET = "moments";
const TTL_SEC = 3600;
// URLs mit weniger Restlaufzeit werden neu signiert — ein Clip, der länger als
// 10 Minuten offen steht, läuft so nicht ins 403.
const MIN_REMAINING_MS = 10 * 60 * 1000;

type Entry = { url: string; expiresAt: number };
const cache = new Map<string, Entry>();

/**
 * Liefert pro media_path eine signierte URL. Pfade, die nicht auflösbar sind
 * (gelöscht, RLS), fehlen im Ergebnis — der Aufrufer filtert.
 */
export async function getSignedMomentUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const result: Record<string, string> = {};
  const missing: string[] = [];

  for (const path of new Set(paths)) {
    const hit = cache.get(path);
    if (hit && hit.expiresAt - now > MIN_REMAINING_MS) {
      result[path] = hit.url;
    } else {
      missing.push(path);
    }
  }

  if (missing.length > 0) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing, TTL_SEC);
    // Zeitstempel VOR der Antwort genommen → eher zu früh als zu spät erneuern.
    const expiresAt = now + TTL_SEC * 1000;
    for (const row of data ?? []) {
      if (!row.path || !row.signedUrl || row.error) continue;
      cache.set(row.path, { url: row.signedUrl, expiresAt });
      result[row.path] = row.signedUrl;
    }
  }

  return result;
}
