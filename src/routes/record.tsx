import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useCamera } from "@/hooks/use-camera";

export const Route = createFileRoute("/record")({
  head: () => ({
    meta: [
      { title: "Aufnahme — Corso" },
      { name: "description", content: "Nimm deinen Moment auf." },
    ],
  }),
  component: RecordPage,
});

// Täglicher Prompt (PRD 4.2) — erscheint mit dem 08:00-Reset, zielt auf Emotion statt Dokumentation.
const DAILY_PROMPT = "Was hat dich heute kurz innehalten lassen?";

function RecordPage() {
  const [cityStory, setCityStory] = useState(true);
  const cam = useCamera();

  const showPrompt = cam.status === "idle" || cam.status === "error";
  const recordProgress = Math.min(cam.elapsedMs / cam.maxMs, 1);

  return (
    <div
      className="relative h-dvh w-full flex flex-col bg-neutral-950 text-white px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
      }}
    >
      {/* Prompt des Tages — nur vor dem Start sichtbar, sonst stört er die Kamera */}
      {showPrompt && (
        <div className="text-center px-2">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/40 font-medium">
            Prompt des Tages
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight leading-snug">{DAILY_PROMPT}</h1>
        </div>
      )}

      {/* Kamera-Fläche */}
      <div
        className="relative mt-6 flex-1 rounded-[2rem] overflow-hidden flex flex-col items-center justify-center gap-3"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.05), transparent 65%), linear-gradient(160deg, #141414 0%, #080808 100%)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset",
        }}
      >
        {/* Live-Preview / Wiedergabe */}
        <video
          ref={cam.videoRef}
          playsInline
          autoPlay
          muted={cam.status !== "recorded"}
          loop={cam.status === "recorded"}
          controls={false}
          src={cam.status === "recorded" && cam.recordedUrl ? cam.recordedUrl : undefined}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            cam.status === "idle" || cam.status === "starting" || cam.status === "error"
              ? "opacity-0"
              : "opacity-100"
          } ${cam.facingMode === "user" && cam.status !== "recorded" ? "scale-x-[-1]" : ""}`}
        />

        {/* Idle: Aufruf zum Starten */}
        {cam.status === "idle" && (
          <>
            <div className="w-20 h-20 rounded-full bg-white/8 border border-white/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-white/30 text-[40px]">photo_camera</span>
            </div>
            <p className="text-white/40 text-sm">Live-Kamera</p>
            <p className="text-white/25 text-xs">Kein Galerie-Upload, keine Filter.</p>
          </>
        )}

        {cam.status === "starting" && (
          <p className="text-white/50 text-sm animate-pulse">Kamera wird gestartet …</p>
        )}

        {cam.status === "error" && cam.error && (
          <div className="px-8 text-center">
            <span className="material-symbols-outlined text-white/40 text-[40px]">videocam_off</span>
            <p className="mt-3 text-sm font-medium text-white/80">{cam.error.title}</p>
            <p className="mt-1 text-xs text-white/40 leading-relaxed">{cam.error.detail}</p>
          </div>
        )}

        {/* Aufnahme-Indikator */}
        {cam.status === "recording" && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-md px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-medium tabular-nums">
              {(cam.elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        )}

        {/* Kamera wechseln — nur in der Live-Preview */}
        {cam.status === "live" && (
          <button
            onClick={cam.switchCamera}
            aria-label="Kamera wechseln"
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[20px]">cameraswitch</span>
          </button>
        )}
      </div>

      {/* Einwilligung Stadt-Story + Steuerung */}
      <div className="mt-6 flex flex-col gap-4">
        <button
          onClick={() => setCityStory((v) => !v)}
          className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.06] border border-white/10 px-4 py-3 active:scale-[0.99] transition-transform"
        >
          <span className="flex items-center gap-2 text-left">
            <span className="material-symbols-outlined text-[20px] text-white/70">movie</span>
            <span className="text-sm">
              Für Stadt-Story freigeben
              <span className="block text-[11px] text-white/40">Kann um 20:00 stadtweit erscheinen</span>
            </span>
          </span>
          <span className={`relative w-11 h-6 rounded-full transition-colors ${cityStory ? "bg-white" : "bg-white/20"}`}>
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${cityStory ? "left-[22px] bg-black" : "left-0.5 bg-white"}`}
            />
          </span>
        </button>

        <CameraControls cam={cam} recordProgress={recordProgress} />
      </div>
    </div>
  );
}

function CameraControls({
  cam,
  recordProgress,
}: {
  cam: ReturnType<typeof useCamera>;
  recordProgress: number;
}) {
  // Vor dem Start / nach Fehler: Kamera anstoßen (braucht User-Geste für iOS)
  if (cam.status === "idle" || cam.status === "starting" || cam.status === "error") {
    return (
      <button
        onClick={() => void cam.start()}
        disabled={cam.status === "starting"}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-full bg-white text-black text-sm font-semibold active:scale-[0.99] transition-transform disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[20px]">videocam</span>
        {cam.status === "error" ? "Erneut versuchen" : "Kamera starten"}
      </button>
    );
  }

  // Clip aufgenommen: verwerfen oder behalten
  if (cam.status === "recorded") {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={cam.retake}
          className="flex-1 flex items-center justify-center gap-2 py-4 rounded-full bg-white/10 border border-white/15 text-white text-sm font-semibold active:scale-[0.99] transition-transform"
        >
          <span className="material-symbols-outlined text-[20px]">replay</span>
          Neu aufnehmen
        </button>
        <button
          disabled
          className="flex-1 flex items-center justify-center gap-2 py-4 rounded-full bg-white text-black text-sm font-semibold disabled:opacity-50"
          title="Hochladen kommt im nächsten Schritt"
        >
          <span className="material-symbols-outlined text-[20px]">check</span>
          Verwenden
        </button>
      </div>
    );
  }

  // Live / Recording: großer Auslöser mit Fortschrittsring
  const recording = cam.status === "recording";
  return (
    <div className="flex justify-center">
      <button
        onClick={recording ? cam.stopRecording : cam.startRecording}
        aria-label={recording ? "Aufnahme stoppen" : "Moment aufnehmen"}
        className="relative h-18 w-18 rounded-full active:scale-95 transition-transform"
        style={{ width: "4.5rem", height: "4.5rem" }}
      >
        {/* Fortschrittsring während der Aufnahme */}
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
          {recording && (
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="#ef4444"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 46}
              strokeDashoffset={2 * Math.PI * 46 * (1 - recordProgress)}
              style={{ transition: "stroke-dashoffset 0.1s linear" }}
            />
          )}
        </svg>
        {/* Innerer Auslöser: Kreis (live) ↔ Quadrat (recording) */}
        <span
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500 transition-all duration-200 ${
            recording ? "h-6 w-6 rounded-md" : "h-14 w-14 rounded-full"
          }`}
        />
      </button>
    </div>
  );
}
