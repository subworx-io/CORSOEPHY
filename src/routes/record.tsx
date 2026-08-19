import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCamera } from "@/hooks/use-camera";
import { useAuth } from "@/lib/auth-context";
import { uploadMoment } from "@/lib/supabase/upload";
import { useTodayPrompt } from "@/lib/prompts/use-today-prompt";
import { logEvent } from "@/lib/events";

export const Route = createFileRoute("/record")({
  head: () => ({
    meta: [
      { title: "Aufnahme — Corso" },
      { name: "description", content: "Nimm deinen Moment auf." },
    ],
  }),
  component: RecordPage,
});

function RecordPage() {
  const [cityStory, setCityStory] = useState(true);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const cam = useCamera();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Täglicher Prompt (PRD 4.2) aus der DB — geteilter Cache mit dem Tages-Splash,
  // daher kein zweiter API-Call. Wechselt mit dem Zyklus-Start um 21:00 (corso_day).
  const { data: todayPrompt } = useTodayPrompt();
  const promptText = todayPrompt?.text ?? "";

  // Kamera-first: beim Betreten des Screens startet die Kamera automatisch.
  // getUserMedia braucht keine User-Geste; der Berechtigungs-Dialog erscheint
  // auch hier. Ref-Guard, damit der StrictMode-Doppelmount nicht zweimal startet.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    void cam.start();
    // Einmaliger Mount-Start — bewusst ohne Abhängigkeiten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUseClip() {
    if (!cam.recordedBlob || !user) return;
    setUploadStatus("uploading");
    setUploadError(null);
    const { post, error } = await uploadMoment(cam.recordedBlob, user.id, cityStory);
    if (error) {
      setUploadStatus("error");
      setUploadError(error);
    } else {
      // moment_posted (Metrik-Tracking): nach erfolgreichem Upload/Post.
      // 🔒 metadata trägt nur die Referenz-ID, keine Clip-Inhalte. Fire-and-forget.
      logEvent("moment_posted", post ? { post_id: post.id } : null);
      setUploadStatus("done");
      await queryClient.invalidateQueries({ queryKey: ["discovery"] });
      setTimeout(() => void navigate({ to: "/" }), 1200);
    }
  }

  const initializing = cam.status === "idle" || cam.status === "starting";
  const showVideo =
    cam.status === "live" || cam.status === "recording" || cam.status === "recorded";
  const showControls = showVideo; // keine Steuerung im Init-/Fehler-Zustand
  const recordProgress = Math.min(cam.elapsedMs / cam.maxMs, 1);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950 text-white">
      {/* Kamera-Bühne: full-bleed mit sanfter Rundung; oben unter der Notch,
          unten knapp über der schwebenden BottomNav. */}
      <div
        className="absolute overflow-hidden rounded-[2.25rem] bg-neutral-900"
        style={{
          top: "calc(env(safe-area-inset-top) + 0.75rem)",
          left: "0.75rem",
          right: "0.75rem",
          bottom: "calc(env(safe-area-inset-bottom) + 5.25rem)",
        }}
      >
        {/* Weiche Basisfläche hinter dem Video — statt Schwarz während Init/Fehler */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 38%, rgba(255,255,255,0.06), transparent 62%), linear-gradient(160deg, #141414 0%, #080808 100%)",
          }}
        />

        {/* Live-Preview / Wiedergabe — Struktur & Props unverändert */}
        <video
          ref={cam.videoRef}
          playsInline
          autoPlay
          muted={cam.status !== "recorded"}
          loop={cam.status === "recorded"}
          controls={false}
          src={cam.status === "recorded" && cam.recordedUrl ? cam.recordedUrl : undefined}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            showVideo ? "opacity-100" : "opacity-0"
          } ${cam.facingMode === "user" && cam.status !== "recorded" ? "scale-x-[-1]" : ""}`}
        />

        {/* Prompt des Tages — dezentes Overlay oben, in jedem Zustand sichtbar */}
        {promptText && <PromptOverlay text={promptText} />}

        {/* Aufnahme-Indikator — oben links, damit er nicht mit dem Prompt kollidiert */}
        {cam.status === "recording" && (
          <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-md">
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
            className="absolute right-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-md transition-transform active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px]">cameraswitch</span>
          </button>
        )}

        {/* Init-Zustand: Berechtigung wird angefragt / Kamera startet */}
        {initializing && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            <p className="text-sm text-white/55">Kamera wird gestartet …</p>
          </div>
        )}

        {/* Fehler / Berechtigung abgelehnt — freundlicher Hinweis + erneut versuchen */}
        {cam.status === "error" && cam.error && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/8">
              <span className="material-symbols-outlined text-[32px] text-white/50">
                videocam_off
              </span>
            </div>
            <div>
              <p className="text-base font-semibold">{cam.error.title}</p>
              <p className="mx-auto mt-1.5 max-w-[17rem] text-[13px] leading-relaxed text-white/55">
                {cam.error.detail}
              </p>
            </div>
            <button
              onClick={() => void cam.start()}
              className="mt-1 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
              Erneut versuchen
            </button>
          </div>
        )}

        {/* Steuerung — schwebt über dem unteren Bildrand */}
        {showControls && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-4 bg-gradient-to-t from-black/60 via-black/20 to-transparent px-5 pb-6 pt-16">
            {/* Einwilligung für den Stadt Corso — kompakte Pille statt Card-Balken.
                Erscheint erst nach der Aufnahme (recorded), direkt über
                Verwenden/Neu: entschieden wird beim Sichten des Takes. */}
            {cam.status === "recorded" && (
              <CityStoryToggle value={cityStory} onToggle={() => setCityStory((v) => !v)} />
            )}

            <CameraControls
              cam={cam}
              recordProgress={recordProgress}
              uploadStatus={uploadStatus}
              uploadError={uploadError}
              onUseClip={() => void handleUseClip()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Prompt des Tages — Editorial-Overlay: ruhige System-Serif (`font-serif`),
// linksbündig wie eine Magazin-Headline, mit kleinem Kursiv-Label statt gesperrter
// Caps. Liegt über dem Live-Bild → weicher Scrim-Verlauf (keine harte Box) +
// drop-shadow für Lesbarkeit auch vor hellem Hintergrund. Nur Tailwind-Tokens.
function PromptOverlay({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/60 via-black/25 to-transparent px-6 pt-5 pb-11">
      <div className="font-serif text-[13px] italic text-white/55">Heute</div>
      <h2 className="mt-1 max-w-[15rem] font-serif text-[27px] font-medium leading-[1.15] tracking-[-0.01em] text-white drop-shadow-md">
        {text}
      </h2>
    </div>
  );
}

// Dezenter An/Aus-Toggle für die Freigabe zum Stadt Corso (🔒 Einwilligung pro Moment).
// Zustand bleibt klar erkennbar: gefüllt/weiß = an, gedimmt/outline = aus.
function CityStoryToggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={value}
        aria-label="Für den Stadt Corso freigeben – kann um 21:00 stadtweit erscheinen"
        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 backdrop-blur-md transition-all active:scale-[0.98] ${
          value ? "border-white bg-white text-black" : "border-white/25 bg-black/40 text-white/80"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">movie</span>
        <span className="text-[13px] font-medium">Stadt Corso</span>
        <span
          className="material-symbols-outlined text-[18px]"
          style={{ fontVariationSettings: value ? "'FILL' 1" : "'FILL' 0" }}
        >
          {value ? "check_circle" : "radio_button_unchecked"}
        </span>
      </button>
      <p className="text-[10px] text-white/50">
        {value ? "Kann um 21:00 stadtweit erscheinen" : "Bleibt privat in deinem Corso"}
      </p>
    </div>
  );
}

function CameraControls({
  cam,
  recordProgress,
  uploadStatus,
  uploadError,
  onUseClip,
}: {
  cam: ReturnType<typeof useCamera>;
  recordProgress: number;
  uploadStatus: "idle" | "uploading" | "done" | "error";
  uploadError: string | null;
  onUseClip: () => void;
}) {
  // Clip aufgenommen: verwerfen oder hochladen — flankierende Rundbuttons.
  if (cam.status === "recorded") {
    const uploading = uploadStatus === "uploading";
    const done = uploadStatus === "done";
    return (
      <div className="flex flex-col items-center gap-3">
        {uploadError && <p className="text-center text-sm text-red-400">{uploadError}</p>}
        <div className="flex items-end justify-center gap-10">
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={cam.retake}
              disabled={uploading || done}
              aria-label="Neu aufnehmen"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/12 text-white transition-transform active:scale-95 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[24px]">replay</span>
            </button>
            <span className="text-[11px] text-white/70">Neu</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={onUseClip}
              disabled={uploading || done}
              aria-label="Verwenden"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black transition-transform active:scale-95 disabled:opacity-60"
            >
              <span
                className={`material-symbols-outlined text-[28px] ${uploading ? "animate-spin" : ""}`}
              >
                {done ? "check_circle" : uploading ? "progress_activity" : "check"}
              </span>
            </button>
            <span className="text-[11px] text-white/70">
              {done ? "Fertig" : uploading ? "Lädt…" : "Verwenden"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Live / Recording: klassischer runder Auslöser mit Fortschrittsring.
  const recording = cam.status === "recording";
  return (
    <button
      onClick={recording ? cam.stopRecording : cam.startRecording}
      aria-label={recording ? "Aufnahme stoppen" : "Moment aufnehmen"}
      className="relative transition-transform active:scale-95"
      style={{ width: "4.75rem", height: "4.75rem" }}
    >
      {/* Fortschrittsring während der Aufnahme */}
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="4"
        />
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
  );
}
