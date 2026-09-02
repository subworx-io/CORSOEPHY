import { useCallback, useEffect, useRef, useState } from "react";

// 🔒 Live-Kamera-Pflicht (PRD): getUserMedia statt Galerie. Kein Upload-Pfad, keine Filter.
// Max. Clip-Länge — rohe, kurze Momente (PRD: ungeschnitten, nicht überproduziert).
export const MAX_RECORD_MS = 15_000;

// Ein Foto-Moment kann aus mehreren Fotos bestehen (PRD: „Foto oder vertikales
// Video"; Mehrfach-Fotos Entscheidung 2. Sep). Cap spiegelt den DB-Check (0023).
export const MAX_PHOTOS = 5;

// Digital-Zoom-Fallback NUR für Fotos: Preview wird per CSS skaliert und die
// Aufnahme exakt gleich aus dem Frame gecroppt — Preview und Moment bleiben
// identisch. Für Video gibt es bewusst KEINEN Digital-Fallback (CSS würde nur
// die Preview zoomen, nicht die Aufnahme — siehe readZoomCapability).
const DIGITAL_ZOOM_MAX = 3;

export type CaptureMode = "video" | "photo";

export interface CapturedPhoto {
  url: string; // Objekt-URL für die Vorschau
  blob: Blob;
}

// Audio bewusst OHNE Sprachverarbeitung aufnehmen: die getUserMedia-Defaults
// (echoCancellation/noiseSuppression/autoGainControl = an) sind für Telefonate
// gebaut. In lauter Umgebung (Musik, Straße) pumpt die automatische Verstärkung
// und die Rauschunterdrückung zerhackt den Klang — genau das „grauenhafte" Audio.
// Die native Kamera-App nimmt ebenfalls unbearbeitet auf. Echo droht nicht: die
// Preview ist während der Aufnahme stumm, beim Stopp wird der Stream beendet.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export type CameraStatus =
  | "idle" // noch nicht gestartet (wartet auf User-Geste)
  | "starting" // getUserMedia läuft
  | "live" // Preview aktiv, bereit zum Aufnehmen
  | "recording"
  | "recorded" // Clip aufgenommen, Wiedergabe
  | "error";

export type FacingMode = "user" | "environment";

interface CameraError {
  title: string;
  detail: string;
}

// Hardware-Zoom des Kamera-Tracks (Pinch-Geste). Noch nicht in lib.dom typisiert.
interface ZoomRange {
  min: number;
  max: number;
  step: number;
}
type ZoomCapabilities = MediaTrackCapabilities & {
  zoom?: { min?: number; max?: number; step?: number };
};
type ZoomConstraintSet = MediaTrackConstraintSet & { zoom?: number };

// iOS Safari nimmt am liebsten mp4/H.264. webm ist Fallback für Android/Desktop.
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function describeError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: "Kamera-Zugriff verweigert",
        detail: "Erlaube den Zugriff in den Einstellungen → Safari → Kamera und lade die App neu.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { title: "Keine Kamera gefunden", detail: "Dieses Gerät meldet keine Kamera." };
    case "NotReadableError":
      return {
        title: "Kamera belegt",
        detail: "Eine andere App nutzt gerade die Kamera. Schließe sie und versuch es erneut.",
      };
    default:
      // Häufigster echter Fall auf iOS: kein HTTPS.
      if (typeof window !== "undefined" && !window.isSecureContext) {
        return {
          title: "Kein sicherer Kontext",
          detail: "Die Kamera braucht HTTPS. Öffne die App über eine https://-Adresse.",
        };
      }
      return { title: "Kamera nicht verfügbar", detail: "Aufnahme wird hier nicht unterstützt." };
  }
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedUrlRef = useRef<string | null>(null);
  const zoomRangeRef = useRef<ZoomRange | null>(null);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<CameraError | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [zoom, setZoomState] = useState(1);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const [mode, setModeState] = useState<CaptureMode>("video");
  const modeRef = useRef<CaptureMode>("video");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const photosRef = useRef<CapturedPhoto[]>([]);
  const [digitalZoom, setDigitalZoomState] = useState(1);
  const digitalZoomRef = useRef(1);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const revokeRecorded = useCallback(() => {
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = null;
    }
  }, []);

  // Liest die Zoom-Fähigkeit des Video-Tracks (nicht jede Kamera kann das).
  // 🔒 Bewusst nur echter Hardware-Zoom via applyConstraints: der landet auch im
  // aufgenommenen Clip. Ein CSS-Scale-Fallback würde nur die Preview zoomen,
  // die Aufnahme aber nicht — Preview und Moment müssen identisch bleiben.
  const readZoomCapability = useCallback((stream: MediaStream) => {
    if (streamRef.current !== stream) return; // Stream wurde inzwischen ersetzt
    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as ZoomCapabilities;
    const z = caps.zoom;
    if (z && typeof z.max === "number" && z.max > (z.min ?? 1)) {
      const range: ZoomRange = { min: z.min ?? 1, max: z.max, step: z.step ?? 0.1 };
      zoomRangeRef.current = range;
      setZoomRange(range);
      const settings = (track.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number };
      setZoomState(settings.zoom ?? range.min);
    }
  }, []);

  // Pinch-Zoom: Wert auf den Hardware-Bereich klemmen und auf den Track anwenden.
  // Ohne Hardware-Zoom greift im FOTO-Modus der Digital-Fallback (Preview-Scale +
  // identischer Crop bei der Aufnahme) — bei Video passiert weiterhin stumm nichts.
  const setZoom = useCallback((value: number) => {
    const range = zoomRangeRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (range && track) {
      const clamped = Math.min(range.max, Math.max(range.min, value));
      setZoomState(clamped);
      track
        .applyConstraints({ advanced: [{ zoom: clamped } as ZoomConstraintSet] })
        .catch(() => {}); // z. B. während eines Kamera-Wechsels — Zoom ist nice-to-have
      return;
    }
    if (modeRef.current === "photo") {
      const clamped = Math.min(DIGITAL_ZOOM_MAX, Math.max(1, value));
      digitalZoomRef.current = clamped;
      setDigitalZoomState(clamped);
    }
  }, []);

  const start = useCallback(
    async (mode: FacingMode = facingMode) => {
      setError(null);
      // Häufigste Ursache auf iOS: kein HTTPS → mediaDevices ist undefined.
      // Das sauber abfangen, statt fälschlich "keine Kamera" zu melden.
      if (!navigator.mediaDevices?.getUserMedia) {
        if (typeof window !== "undefined" && !window.isSecureContext) {
          setError({
            title: "Kein sicherer Kontext (kein HTTPS)",
            detail:
              "Die Kamera ist nur über https:// oder localhost erreichbar. Öffne die App über die ngrok-https-Adresse, nicht über die IP.",
          });
        } else {
          setError({
            title: "Kamera-API nicht verfügbar",
            detail: "Dieser Browser stellt getUserMedia nicht bereit.",
          });
        }
        setStatus("error");
        return;
      }
      setStatus("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode },
          audio: AUDIO_CONSTRAINTS,
        });
        stopStream();
        streamRef.current = stream;
        setFacingMode(mode);
        // Zoom pro Stream neu ermitteln (Front-/Rückkamera unterscheiden sich).
        zoomRangeRef.current = null;
        setZoomRange(null);
        setZoomState(1);
        digitalZoomRef.current = 1;
        setDigitalZoomState(1);
        readZoomCapability(stream);
        // Manche Geräte melden die Zoom-Capability erst kurz nach dem Start.
        setTimeout(() => {
          if (!zoomRangeRef.current) readZoomCapability(stream);
        }, 400);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS: muss inline + muted abspielen, sonst Vollbild-Player oder Block.
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("live");
      } catch (err) {
        setError(describeError(err));
        setStatus("error");
      }
    },
    [facingMode, stopStream, readZoomCapability],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    clearTimer();
  }, [clearTimer]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setError({
        title: "Aufnahme nicht möglich",
        detail: "MediaRecorder wird nicht unterstützt.",
      });
      return;
    }
    revokeRecorded();
    setRecordedUrl(null);
    chunksRef.current = [];

    const mimeType = pickMimeType();
    // Audio-Bitrate explizit setzen: Plattform-Defaults sind teils sprachoptimiert
    // niedrig — 128 kbit/s trägt auch Musik/laute Umgebung ordentlich.
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 128_000,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "video/mp4" });
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      // Live-Stream beenden: Mic zu (sonst Echo/Rückkopplung bei der Wiedergabe)
      // und srcObject freigeben, damit das <video> die Aufnahme (src) abspielt
      // statt weiter das Live-Bild zu zeigen (srcObject hätte Vorrang vor src).
      stopStream();
      setRecordedUrl(url);
      setRecordedBlob(blob);
      setStatus("recorded");
    };

    recorder.start();
    setStatus("recording");

    const startedAt = Date.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_RECORD_MS) stopRecording();
    }, 100);
  }, [revokeRecorded, stopRecording, stopStream]);

  // Verwirft den Clip und kehrt zur Live-Preview zurück.
  // Der Live-Stream wurde beim Aufnahme-Stopp beendet → Kamera neu starten.
  const retake = useCallback(() => {
    revokeRecorded();
    setRecordedUrl(null);
    setRecordedBlob(null);
    setElapsedMs(0);
    void start();
  }, [revokeRecorded, start]);

  // ── Foto-Aufnahme ────────────────────────────────────────────────────────
  // 🔒 Auch Fotos entstehen NUR aus dem Live-Stream: der aktuelle Frame des
  // <video>-Elements wird auf ein Canvas gezeichnet. Kein Galerie-Pfad, keine
  // Filter. Der Digital-Zoom croppt exakt das, was die Preview zeigt.
  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current || video.videoWidth === 0) return;
    if (photosRef.current.length >= MAX_PHOTOS) return;

    const z = zoomRangeRef.current ? 1 : digitalZoomRef.current; // Hardware-Zoom steckt schon im Frame
    const sw = video.videoWidth / z;
    const sh = video.videoHeight / z;
    const sx = (video.videoWidth - sw) / 2;
    const sy = (video.videoHeight - sh) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return;

    const photo: CapturedPhoto = { url: URL.createObjectURL(blob), blob };
    photosRef.current = [...photosRef.current, photo];
    setPhotos(photosRef.current);
  }, []);

  const removePhoto = useCallback((index: number) => {
    const photo = photosRef.current[index];
    if (!photo) return;
    URL.revokeObjectURL(photo.url);
    photosRef.current = photosRef.current.filter((_, i) => i !== index);
    setPhotos(photosRef.current);
  }, []);

  const clearPhotos = useCallback(() => {
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    photosRef.current = [];
    setPhotos([]);
  }, []);

  // Moduswechsel Video ↔ Foto. Zurück zu Video setzt den Digital-Zoom zurück —
  // er existiert für Video nicht (die Aufnahme würde sonst von der Preview
  // abweichen). Aufgenommene Fotos überleben den Wechsel nicht (bewusst simpel:
  // ein Moment ist entweder Video oder Foto-Stapel).
  const setMode = useCallback(
    (next: CaptureMode) => {
      modeRef.current = next;
      setModeState(next);
      if (next === "video") {
        digitalZoomRef.current = 1;
        setDigitalZoomState(1);
        clearPhotos();
      }
    },
    [clearPhotos],
  );

  const switchCamera = useCallback(() => {
    void start(facingMode === "user" ? "environment" : "user");
  }, [facingMode, start]);

  // Vollständiges Aufräumen beim Unmount: Tracks stoppen, Blob-URLs freigeben.
  useEffect(() => {
    return () => {
      clearTimer();
      stopStream();
      revokeRecorded();
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
      photosRef.current = [];
    };
  }, [clearTimer, stopStream, revokeRecorded]);

  return {
    videoRef,
    status,
    error,
    facingMode,
    // Ohne Hardware-Zoom zeigt `zoom` im Foto-Modus den Digital-Zoom.
    zoom: zoomRange !== null ? zoom : digitalZoom,
    canZoom: zoomRange !== null || mode === "photo",
    setZoom,
    // > 1 nur im Foto-Modus ohne Hardware-Zoom — die Preview muss dann per CSS
    // um genau diesen Faktor skaliert werden (Crop bei der Aufnahme ist identisch).
    digitalZoom,
    mode,
    setMode,
    photos,
    capturePhoto,
    removePhoto,
    clearPhotos,
    maxPhotos: MAX_PHOTOS,
    recordedUrl,
    recordedBlob,
    elapsedMs,
    maxMs: MAX_RECORD_MS,
    start,
    startRecording,
    stopRecording,
    retake,
    switchCamera,
  };
}
