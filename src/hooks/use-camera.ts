import { useCallback, useEffect, useRef, useState } from "react";

// 🔒 Live-Kamera-Pflicht (PRD): getUserMedia statt Galerie. Kein Upload-Pfad, keine Filter.
// Max. Clip-Länge — rohe, kurze Momente (PRD: ungeschnitten, nicht überproduziert).
export const MAX_RECORD_MS = 15_000;

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
  const setZoom = useCallback((value: number) => {
    const range = zoomRangeRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!range || !track) return;
    const clamped = Math.min(range.max, Math.max(range.min, value));
    setZoomState(clamped);
    track.applyConstraints({ advanced: [{ zoom: clamped } as ZoomConstraintSet] }).catch(() => {}); // z. B. während eines Kamera-Wechsels — Zoom ist nice-to-have
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
          audio: true,
        });
        stopStream();
        streamRef.current = stream;
        setFacingMode(mode);
        // Zoom pro Stream neu ermitteln (Front-/Rückkamera unterscheiden sich).
        zoomRangeRef.current = null;
        setZoomRange(null);
        setZoomState(1);
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
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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

  const switchCamera = useCallback(() => {
    void start(facingMode === "user" ? "environment" : "user");
  }, [facingMode, start]);

  // Vollständiges Aufräumen beim Unmount: Tracks stoppen, Blob-URL freigeben.
  useEffect(() => {
    return () => {
      clearTimer();
      stopStream();
      revokeRecorded();
    };
  }, [clearTimer, stopStream, revokeRecorded]);

  return {
    videoRef,
    status,
    error,
    facingMode,
    zoom,
    canZoom: zoomRange !== null,
    setZoom,
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
