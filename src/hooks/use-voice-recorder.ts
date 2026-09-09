import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS } from "@/lib/circle/chat-media";

// Sprachnachrichten für den Circle-Chat.
//
// ⚠️ BEWUSST NICHT `use-camera.ts`. Der dortige Hook ist die 🔒 Live-Kamera-
// Pflicht des öffentlichen Flows: er greift Video UND Audio ab, hängt an
// Vorschau, Zoom und Foto-Frames und mündet in `posts`. Hier braucht es das
// genaue Gegenteil — nur ein Mikrofon, kein Bild, kein Bezug zu Momenten.
// Ein gemeinsamer Hook hätte beide Zwecke verwässert.
//
// Bedienung (Entscheidung Dominik): Halten zum Aufnehmen, Loslassen sendet,
// Wisch nach links bricht ab — das WhatsApp-Muster.
//
// ⚠️ Auf iOS gibt es dabei KEINE Haptik: gemessen am 4. Sep 2026 löst ein
// Impuls nur bei einem echten Fingertipp auf ein <input type="checkbox" switch>
// aus, nicht beim Halten oder Wischen. Die Aufnahme muss sich deshalb rein
// optisch quittieren (laufende Zeit + Pegel).

/** Audio-Format, das der Browser wirklich kann — Safari mag mp4, Chrome webm. */
function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  /** 0..1 — grober Pegel für den Balken, keine echte Waveform (die kostet jeden Frame). */
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const rafRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelledRef = useRef(false);
  /** Auflösung des laufenden stop()-Versprechens. */
  const resolveRef = useRef<((r: VoiceRecording | null) => void) | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setRecording(false);
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return false;
    setError(null);
    cancelledRef.current = false;

    let stream: MediaStream;
    try {
      // Bewusst OHNE die Telefonie-Defaults: echoCancellation & Co. zerlegen
      // laute Umgebungen (dieselbe Erkenntnis wie beim Video-Audio, 2. Sep).
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      setError("Kein Zugriff auf das Mikrofon.");
      return false;
    }
    if (typeof MediaRecorder === "undefined") {
      stream.getTracks().forEach((t) => t.stop());
      setError("Sprachnachrichten werden auf diesem Gerät nicht unterstützt.");
      return false;
    }

    streamRef.current = stream;
    const mime = pickAudioMime();
    const recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: 64_000,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
      const resolve = resolveRef.current;
      resolveRef.current = null;
      teardown();
      // Zu kurz = Fehlgriff beim Antippen des Mikrofons, nicht gewollt.
      if (cancelledRef.current || durationMs < 400 || blob.size === 0) {
        resolve?.(null);
        return;
      }
      resolve?.({ blob, mime: mime || "audio/webm", durationMs });
    };

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setRecording(true);
    setElapsedMs(0);

    // Pegel + Uhr in EINER rAF-Schleife.
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 90));
        setElapsedMs(Date.now() - startedAtRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Ohne AudioContext bleibt der Pegel bei 0 — die Uhr muss trotzdem laufen.
      const tick = () => {
        setElapsedMs(Date.now() - startedAtRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
    return true;
  }, [teardown]);

  /** Beendet die Aufnahme und liefert sie; null = abgebrochen oder zu kurz. */
  const stop = useCallback((): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(null);
    });
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    void stop();
  }, [stop]);

  // Harte Obergrenze: bei 2 Minuten wird von selbst beendet — die Nachricht
  // geht dann raus, statt still weiterzulaufen und am Limit zu scheitern.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const autoStopRef = useRef<((r: VoiceRecording | null) => void) | null>(null);
  useEffect(() => {
    if (!recording || elapsedMs < LIMITS.voiceMs) return;
    void stopRef.current().then((r) => autoStopRef.current?.(r));
  }, [recording, elapsedMs]);

  /** Callback für den Fall, dass die 2-Minuten-Grenze die Aufnahme beendet. */
  const onAutoStop = useCallback((cb: (r: VoiceRecording | null) => void) => {
    autoStopRef.current = cb;
  }, []);

  return { recording, elapsedMs, level, error, start, stop, cancel, onAutoStop };
}
