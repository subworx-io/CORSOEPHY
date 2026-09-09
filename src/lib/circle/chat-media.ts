import { supabase } from "@/lib/supabase/client";

// Chat-Medien: Upload und Auslieferung für den Circle-Chat.
//
// ⚠️ BEWUSST GETRENNT VON `lib/supabase/upload.ts`.
// Das hier ist der EINZIGE Pfad, auf dem Dateien aus der Galerie kommen dürfen
// (Entscheidung Dominik, 9. Sep 2026: der Chat ist ein privater Eins-zu-eins-
// Raum ohne Publikum; die 🔒 Live-Kamera-Pflicht richtet sich gegen
// Selbstinszenierung VOR DER STADT, nicht gegen ein Foto an einen Menschen).
//
// Die Trennung ist physisch, nicht nur konventionell:
//   - anderer Bucket   `chat-media` (privat) statt `moments` (für alle lesbar)
//   - andere Tabelle   circle_messages statt posts
//   - kein gemeinsamer Code-Pfad mit uploadMoment()/uploadPhotoMoment()
//   - `posts` wird von hier NIE angefasst → kein Moment kann so entstehen
// Wer die Galerie-Ausnahme in den öffentlichen Flow tragen will, müsste all das
// bewusst durchbrechen. Bitte nicht.

/** Pfadschema: <connection_id>/<sender_id>/<uuid>.<ext> — daran hängen die Storage-Policies. */
const BUCKET = "chat-media";

/** Grenzwerte (Entscheidung Dominik). Die Dateigröße erzwingt zusätzlich der Bucket. */
export const LIMITS = {
  photoBytes: 10 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024,
  videoMs: 60_000,
  voiceMs: 120_000,
  /** Lange Kante, auf die Fotos vor dem Upload heruntergerechnet werden. */
  photoMaxEdge: 1920,
} as const;

export type ChatMediaKind = "photo" | "video" | "voice";

export interface ChatAttachment {
  kind: ChatMediaKind;
  path: string;
  mime: string;
  bytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

const extFor = (mime: string): string => {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
  };
  return map[mime] ?? mime.split("/")[1]?.split(";")[0] ?? "bin";
};

/**
 * Rechnet ein Foto auf die lange Kante herunter und kodiert es als JPEG.
 * Spart Leitung und Speicher, und nimmt nebenbei HEIC die Sonderrolle: was der
 * Browser darstellen kann, kann er auch auf ein Canvas zeichnen. Scheitert das
 * (manche iOS-HEIC), wird das Original unverändert hochgeladen.
 */
async function downscalePhoto(
  file: File,
): Promise<{ blob: Blob; mime: string; width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LIMITS.photoMaxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("kein 2d-Kontext");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    if (!blob) throw new Error("toBlob leer");
    return { blob, mime: "image/jpeg", width: w, height: h };
  } catch {
    // Lieber das Original als gar nichts.
    return { blob: file, mime: file.type || "image/jpeg" };
  }
}

/** Liest Dauer (und bei Video die Maße) aus den Metadaten — ohne die Datei zu dekodieren. */
function readMediaMeta(
  file: Blob,
  tag: "video" | "audio",
): Promise<{ durationMs?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(tag);
    const done = (v: { durationMs?: number; width?: number; height?: number }) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined;
      if (tag === "video") {
        const v = el as HTMLVideoElement;
        done({
          durationMs: d,
          width: v.videoWidth || undefined,
          height: v.videoHeight || undefined,
        });
      } else {
        done({ durationMs: d });
      }
    };
    el.onerror = () => done({});
    el.src = url;
  });
}

/**
 * Lädt einen Anhang in den privaten Chat-Bucket.
 * Gibt eine sprechende Fehlermeldung zurück statt zu werfen — der Chat soll
 * einen zu großen Clip erklären, nicht abstürzen.
 */
export async function uploadChatMedia({
  file,
  kind,
  connectionId,
  senderId,
  durationMs,
}: {
  file: Blob;
  kind: ChatMediaKind;
  connectionId: string;
  senderId: string;
  /** Bei Sprachnachrichten schon bekannt (der Recorder hat mitgezählt). */
  durationMs?: number;
}): Promise<{ attachment: ChatAttachment | null; error: string | null }> {
  let blob: Blob = file;
  let mime = file.type || "application/octet-stream";
  let width: number | undefined;
  let height: number | undefined;
  let duration = durationMs;

  if (kind === "photo") {
    if (file.size > LIMITS.photoBytes * 4) {
      return { attachment: null, error: "Dieses Foto ist zu groß." };
    }
    const down = await downscalePhoto(file as File);
    blob = down.blob;
    mime = down.mime;
    width = down.width;
    height = down.height;
    if (blob.size > LIMITS.photoBytes) {
      return { attachment: null, error: "Dieses Foto ist zu groß." };
    }
  }

  if (kind === "video") {
    if (file.size > LIMITS.videoBytes) {
      return { attachment: null, error: "Das Video ist zu groß (max. 50 MB)." };
    }
    const meta = await readMediaMeta(file, "video");
    // Die LÄNGE kann nur der Client prüfen — serverseitig greift die Größe.
    if (meta.durationMs && meta.durationMs > LIMITS.videoMs + 1000) {
      return { attachment: null, error: "Das Video ist länger als 60 Sekunden." };
    }
    duration = meta.durationMs;
    width = meta.width;
    height = meta.height;
  }

  if (kind === "voice" && duration && duration > LIMITS.voiceMs + 1000) {
    return { attachment: null, error: "Die Sprachnachricht ist zu lang (max. 2 Minuten)." };
  }

  const path = `${connectionId}/${senderId}/${crypto.randomUUID()}.${extFor(mime)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime });

  if (error) {
    return { attachment: null, error: "Der Anhang konnte nicht hochgeladen werden." };
  }

  return {
    attachment: { kind, path, mime, bytes: blob.size, durationMs: duration, width, height },
    error: null,
  };
}

/** Aufräumen, wenn der Insert der Nachricht NACH dem Upload scheitert. */
export async function removeChatMedia(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

// ── Signierte URLs ──────────────────────────────────────────────────────────
// Eigener Cache, bewusst getrennt von signed-urls.ts (das hängt fest am
// `moments`-Bucket). 🔒 Eine signierte URL bekommt hier nur, wer die
// SELECT-Policy erfüllt — also einer der beiden Partner. Ein Dritter erhält
// vom Server keine URL, nicht bloß eine ausgeblendete Kachel.
const TTL_SECONDS = 60 * 60;
const RENEW_BEFORE_MS = 10 * 60 * 1000;
const cache = new Map<string, { url: string; expiresAt: number }>();

export async function getChatMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];

  for (const path of Array.from(new Set(paths))) {
    const hit = cache.get(path);
    if (hit && hit.expiresAt - now > RENEW_BEFORE_MS) out[path] = hit.url;
    else missing.push(path);
  }
  if (missing.length === 0) return out;

  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing, TTL_SECONDS);
  for (const row of data ?? []) {
    if (!row.signedUrl || !row.path) continue;
    cache.set(row.path, { url: row.signedUrl, expiresAt: now + TTL_SECONDS * 1000 });
    out[row.path] = row.signedUrl;
  }
  return out;
}
