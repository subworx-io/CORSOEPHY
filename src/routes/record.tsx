import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCamera } from "@/hooks/use-camera";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { useAuth } from "@/lib/auth-context";
import { uploadMoment, uploadPhotoMoment } from "@/lib/supabase/upload";
import { logEvent } from "@/lib/events";
import { haptic } from "@/lib/haptics";
import { HapticTapTarget } from "@/components/haptic-tap";
import { PhotoReview } from "@/components/photo-review";

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

  // 🔒 Pinch-Zoom nur als echter Kamera-Zoom (siehe use-camera) — deshalb nur
  // aktiv, wenn ein Live-Stream läuft und die Hardware zoomen kann.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pinching = usePinchZoom({
    targetRef: stageRef,
    enabled: cam.canZoom && (cam.status === "live" || cam.status === "recording"),
    zoom: cam.zoom,
    onZoom: cam.setZoom,
  });

  // Zoomfaktor-Anzeige: sichtbar während der Geste, blendet kurz danach aus.
  const [zoomBadge, setZoomBadge] = useState(false);
  useEffect(() => {
    if (pinching) {
      setZoomBadge(true);
      return;
    }
    const timer = setTimeout(() => setZoomBadge(false), 800);
    return () => clearTimeout(timer);
  }, [pinching]);

  // … auch beim Daumen-Slide-Zoom (Auslöser gedrückt halten + hochschieben):
  // jede Zoom-Änderung blendet die Anzeige kurz ein.
  const prevZoomRef = useRef(cam.zoom);
  useEffect(() => {
    if (prevZoomRef.current === cam.zoom) return;
    prevZoomRef.current = cam.zoom;
    if (cam.status !== "recording" && cam.status !== "live") return;
    setZoomBadge(true);
    const timer = setTimeout(() => setZoomBadge(false), 800);
    return () => clearTimeout(timer);
  }, [cam.zoom, cam.status]);

  async function handleUseClip() {
    if (!cam.recordedBlob || !user) return;
    setUploadStatus("uploading");
    setUploadError(null);
    const { post, error } = await uploadMoment(cam.recordedBlob, user.id, cityStory);
    if (error) {
      setUploadStatus("error");
      setUploadError(error);
      haptic("error");
    } else {
      // moment_posted (Metrik-Tracking): nach erfolgreichem Upload/Post.
      // 🔒 metadata trägt nur die Referenz-ID, keine Clip-Inhalte. Fire-and-forget.
      logEvent("moment_posted", post ? { post_id: post.id } : null);
      setUploadStatus("done");
      haptic("success");
      await queryClient.invalidateQueries({ queryKey: ["discovery"] });
      setTimeout(() => void navigate({ to: "/" }), 1200);
    }
  }

  async function handleUsePhotos() {
    if (cam.photos.length === 0 || !user) return;
    setUploadStatus("uploading");
    setUploadError(null);
    const { post, error } = await uploadPhotoMoment(
      cam.photos.map((p) => p.blob),
      user.id,
      cityStory,
    );
    if (error) {
      setUploadStatus("error");
      setUploadError(error);
      haptic("error");
    } else {
      logEvent("moment_posted", post ? { post_id: post.id } : null);
      setUploadStatus("done");
      haptic("success");
      await queryClient.invalidateQueries({ queryKey: ["discovery"] });
      setTimeout(() => void navigate({ to: "/" }), 1200);
    }
  }

  // Foto-Sichtung (#24): Index des angetippten Fotos, sonst null. Liegt bewusst
  // hier oben und nicht in PhotoControls — der Viewer ist ein Vollbild-Overlay
  // über der ganzen Kamera, kein Teil der Steuerleiste.
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

  // Kurzer weißer Blitz als Aufnahme-Feedback beim Foto.
  const [flash, setFlash] = useState(false);
  function handleCapturePhoto() {
    // Erstes Foto schaltet intern in den Foto-Modus (aktiviert u.a. den
    // Digital-Zoom-Fallback aus use-camera; die UI selbst ist modeless).
    if (cam.photos.length === 0) cam.setMode("photo");
    haptic("tap");
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    void cam.capturePhoto();
  }

  const initializing = cam.status === "idle" || cam.status === "starting";
  const showVideo =
    cam.status === "live" || cam.status === "recording" || cam.status === "recorded";
  // Spiegelung (Frontkamera, nur live) und Digital-Zoom teilen sich den Transform.
  const previewTransform =
    [
      cam.facingMode === "user" && cam.status !== "recorded" ? "scaleX(-1)" : "",
      cam.digitalZoom > 1 ? `scale(${cam.digitalZoom})` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const showControls = showVideo; // keine Steuerung im Init-/Fehler-Zustand
  const recordProgress = Math.min(cam.elapsedMs / cam.maxMs, 1);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950 text-white">
      {/* Kamera-Bühne: full-bleed mit sanfter Rundung; oben unter der Notch,
          unten knapp über der schwebenden BottomNav. */}
      <div
        ref={stageRef}
        className="absolute touch-none overflow-hidden rounded-[2.25rem] bg-neutral-900"
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

        {/* Live-Preview / Wiedergabe — Spiegelung (Frontkamera) und Digital-Zoom
            (Foto-Modus ohne Hardware-Zoom) leben zusammen im style-Transform.
            Der Digital-Zoom skaliert die Preview exakt um den Faktor, den die
            Aufnahme croppt — Preview und Moment bleiben identisch. */}
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
          }`}
          style={{ transform: previewTransform }}
        />

        {/* Foto-Blitz — kurzes Aufleuchten als Auslöse-Feedback */}
        <div
          className="pointer-events-none absolute inset-0 z-40 bg-white transition-opacity"
          style={{ opacity: flash ? 0.7 : 0, transitionDuration: flash ? "0ms" : "300ms" }}
        />

        {/* Aufnahme-Indikator — oben links */}
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

        {/* Zoomfaktor-Anzeige während der Pinch-Geste */}
        {zoomBadge && (cam.status === "live" || cam.status === "recording") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-40 z-30 flex justify-center">
            <span className="rounded-full bg-black/50 px-3 py-1.5 text-[13px] font-medium tabular-nums backdrop-blur-md">
              {cam.zoom.toFixed(1)}×
            </span>
          </div>
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
                Erscheint erst, wenn es etwas zu sichten gibt (Clip aufgenommen bzw.
                erstes Foto im Stapel): entschieden wird beim Sichten des Takes. */}
            {(cam.status === "recorded" || cam.photos.length > 0) && (
              <CityStoryToggle value={cityStory} onToggle={() => setCityStory((v) => !v)} />
            )}

            {/* Modeless (Entscheidung Dominik, 2. Sep): EIN Auslöser — Tippen
                legt ein Foto auf den Stapel, Halten nimmt Video auf. Sobald der
                Stapel Fotos enthält, ist der Moment ein Foto-Moment (kein Video
                mehr, bis der Stapel geleert ist). */}
            {cam.status === "recorded" ? (
              <RecordedControls
                cam={cam}
                uploadStatus={uploadStatus}
                uploadError={uploadError}
                onUseClip={() => void handleUseClip()}
              />
            ) : cam.photos.length > 0 ? (
              <PhotoControls
                cam={cam}
                uploadStatus={uploadStatus}
                uploadError={uploadError}
                onCapture={handleCapturePhoto}
                onUsePhotos={() => void handleUsePhotos()}
                onOpenReview={(i) => {
                  haptic("tap");
                  setReviewIndex(i);
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                <UnifiedShutter
                  cam={cam}
                  recordProgress={recordProgress}
                  onPhoto={handleCapturePhoto}
                />
                {cam.status === "live" && (
                  <p className="text-[11px] font-medium text-white/50">
                    Tippen für ein Foto · Halten für Video
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Foto-Sichtung (#24) — Vollbild über der ganzen Kamera. Verwerfen läuft
          über dieselbe cam.removePhoto()-Kante wie früher das × am Thumbnail,
          der Stapel bleibt also die eine Wahrheit. Während des Uploads zu, sonst
          könnte man einem laufenden Upload den Stapel unter den Füßen wegziehen. */}
      {reviewIndex !== null && uploadStatus === "idle" && cam.photos.length > 0 && (
        <PhotoReview
          photos={cam.photos}
          initialIndex={Math.min(reviewIndex, cam.photos.length - 1)}
          onRemove={(i) => cam.removePhoto(i)}
          onClose={() => setReviewIndex(null)}
        />
      )}
    </div>
  );
}

// Dezenter An/Aus-Toggle für die Freigabe zum Stadt Corso (🔒 Einwilligung pro Moment).
// Zustand bleibt klar erkennbar: gefüllt/weiß = an, gedimmt/outline = aus.
function CityStoryToggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <div className="relative flex flex-col items-center gap-1.5">
      <HapticTapTarget label="Stadt-Corso-Freigabe" onTap={onToggle} className="h-auto" />
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={value}
        aria-label="Für den Stadt Corso freigeben – kann jederzeit stadtweit erscheinen"
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
        {value ? "Kann jederzeit in den Corso rücken" : "Bleibt privat in deinem Corso"}
      </p>
    </div>
  );
}

// Ab dieser Druckdauer wird aus dem Tipp ein Video (darunter: Foto). Kurz genug,
// dass Video sich sofort anfühlt, lang genug, dass ein normaler Tipp nie
// versehentlich aufnimmt.
const HOLD_TO_RECORD_MS = 300;

// EIN Auslöser statt Modus-Umschalter (Entscheidung Dominik, 2. Sep):
// Tippen = Foto auf den Stapel, Halten = Video (nur solange der Stapel leer ist —
// diese Komponente wird gar nicht erst gerendert, sobald Fotos liegen).
function UnifiedShutter({
  cam,
  recordProgress,
  onPhoto,
}: {
  cam: ReturnType<typeof useCamera>;
  recordProgress: number;
  onPhoto: () => void;
}) {
  const holdTimer = useRef<number | null>(null);
  const startedRecordingRef = useRef(false);
  // Slide-Zoom (Snapchat-Muster): Daumen während der Aufnahme hochschieben =
  // reinzoomen, runter = wieder raus. Baseline ist der Zoom beim Drücken.
  const pressYRef = useRef(0);
  const zoomStartRef = useRef(1);
  const recording = cam.status === "recording";

  // Verwaisten Hold-Timer beim Unmount aufräumen.
  useEffect(() => {
    return () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
    };
  }, []);

  const clearHold = () => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const beginPress = (e: React.PointerEvent<HTMLElement>) => {
    if (cam.status !== "live") return;
    // Pointer einfangen: das pointerup kommt auch dann bei uns an, wenn der
    // Finger während der Aufnahme vom Auslöser rutscht.
    e.currentTarget.setPointerCapture(e.pointerId);
    startedRecordingRef.current = false;
    pressYRef.current = e.clientY;
    zoomStartRef.current = cam.zoom;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      startedRecordingRef.current = true;
      // 🔒 Video kennt keinen Digital-Zoom-Fallback (Preview müsste sonst vom
      // Clip abweichen) — setMode("video") setzt ihn zurück, bevor es losgeht.
      cam.setMode("video");
      cam.startRecording();
      haptic("impact");
    }, HOLD_TO_RECORD_MS);
  };

  // Während der Aufnahme folgt der Zoom dem Daumen (der Pointer ist auf dem
  // Auslöser gefangen, die Events kommen also auch neben dem Button noch an).
  // 220 px nach oben = Verdopplung — exponentiell fühlt sich wie in nativen
  // Kamera-Apps an. Ohne Hardware-Zoom passiert stumm nichts (setZoom no-opt,
  // gleiche Regel wie beim Pinch: kein CSS-Fallback für Video).
  const movePress = (e: React.PointerEvent<HTMLElement>) => {
    if (!startedRecordingRef.current || !cam.canZoom) return;
    const dy = pressYRef.current - e.clientY; // hoch = positiv
    cam.setZoom(zoomStartRef.current * Math.pow(2, dy / 220));
  };

  const endPress = () => {
    const held = startedRecordingRef.current;
    clearHold();
    startedRecordingRef.current = false;
    if (held || cam.status === "recording") {
      cam.stopRecording();
      haptic("tap");
    } else if (cam.status === "live") {
      onPhoto();
    }
  };

  const cancelPress = () => {
    clearHold();
    if (startedRecordingRef.current || cam.status === "recording") {
      cam.stopRecording();
      haptic("warning");
    }
    startedRecordingRef.current = false;
  };

  return (
    <span
      className="relative inline-flex transition-transform active:scale-95 has-[input:active]:scale-95"
      style={{ width: "4.75rem", height: "4.75rem" }}
    >
      {/* Auf dem iPhone liegt hier ein unsichtbarer System-Schalter darüber und
          nimmt die Geste entgegen — nur ein echter Fingertipp darauf löst dort
          Haptik aus (siehe src/lib/haptics.ts). */}
      <HapticTapTarget
        label="Auslöser"
        onTap={() => {}}
        onPointerDown={beginPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: "none" }}
      />
      <button
        onPointerDown={beginPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Tippen für ein Foto, Halten für Video — beim Halten hochschieben zum Zoomen"
        className="relative h-full w-full select-none"
        style={{ touchAction: "none", WebkitUserSelect: "none" }}
      >
        {/* Fortschrittsring während der Video-Aufnahme */}
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
        {/* Innerer Auslöser: weißer Kreis (Foto) ↔ rotes Quadrat (Video läuft) */}
        <span
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-200 ${
            recording ? "h-6 w-6 rounded-md bg-red-500" : "h-14 w-14 rounded-full bg-white"
          }`}
        />
      </button>
    </span>
  );
}

// Foto-Stapel begonnen: Auslöser bleibt nach jedem Foto nutzbar (bis MAX_PHOTOS), der
// Stapel wächst als Thumbnail-Strip. Jedes Foto einzeln entfernbar; „Verwenden"
// lädt den ganzen Stapel als EINEN Moment hoch.
function PhotoControls({
  cam,
  uploadStatus,
  uploadError,
  onCapture,
  onUsePhotos,
  onOpenReview,
}: {
  cam: ReturnType<typeof useCamera>;
  uploadStatus: "idle" | "uploading" | "done" | "error";
  uploadError: string | null;
  onCapture: () => void;
  onUsePhotos: () => void;
  /** Thumbnail angetippt → Vollbild-Sichtung an dieser Stelle öffnen. */
  onOpenReview: (index: number) => void;
}) {
  const uploading = uploadStatus === "uploading";
  const done = uploadStatus === "done";
  const hasPhotos = cam.photos.length > 0;
  const full = cam.photos.length >= cam.maxPhotos;

  return (
    <div className="flex flex-col items-center gap-3">
      {uploadError && <p className="text-center text-sm text-red-400">{uploadError}</p>}

      {/* Aufgenommene Fotos — leicht gedrehter Mini-Stapel. Jedes Thumbnail ist
          ein Knopf: Tippen öffnet die Vollbild-Sichtung an dieser Stelle (#24).
          Die × sind seit dem 4. Sep 2026 weg — sie überlappten sich ab drei
          Fotos gegenseitig und waren als 20-px-Kreis kaum zu treffen (#25).
          Verworfen wird jetzt im Viewer, wo man das Bild auch wirklich sieht.
          Dafür stehen die Bilder mit einer kleinen Lücke statt überlappend:
          Optik bleibt „hingelegte Prints", aber jedes ist voll tippbar. */}
      {hasPhotos && (
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-end justify-center gap-1">
            {cam.photos.map((p, i) => (
              <button
                key={p.url}
                type="button"
                onClick={() => onOpenReview(i)}
                aria-label={`Foto ${i + 1} ansehen`}
                className="relative transition-transform active:scale-95"
                style={{ transform: `rotate(${i % 2 === 0 ? 2 : -2}deg)` }}
              >
                <img
                  src={p.url}
                  alt=""
                  draggable={false}
                  className="h-16 w-12 rounded-lg border border-white/25 object-cover shadow-lg"
                />
              </button>
            ))}
          </div>
          {!uploading && !done && (
            <span className="text-[11px] text-white/45">Tippen zum Ansehen</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-center gap-10">
        {/* linke Spalte: Zähler, hält den Auslöser mittig */}
        <div className="flex w-14 flex-col items-center">
          {hasPhotos && (
            <span className="text-[11px] tabular-nums text-white/60">
              {cam.photos.length}/{cam.maxPhotos}
            </span>
          )}
        </div>

        {/* Auslöser — weißer Kreis (Foto), gedimmt wenn der Stapel voll ist */}
        <span
          className="relative inline-flex transition-transform active:scale-95 has-[input:active]:scale-95"
          style={{ width: "4.75rem", height: "4.75rem" }}
        >
          <HapticTapTarget
            label="Foto aufnehmen"
            onTap={onCapture}
            disabled={full || uploading || done}
          />
          <button
            onClick={onCapture}
            disabled={full || uploading || done}
            aria-label="Foto aufnehmen"
            className="relative h-full w-full disabled:opacity-40"
          >
            <svg className="absolute inset-0" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth="4"
              />
            </svg>
            <span className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          </button>
        </span>

        {/* rechte Spalte: Verwenden — erscheint mit dem ersten Foto */}
        <div className="flex w-14 flex-col items-center gap-1.5">
          {hasPhotos && (
            <>
              <span className="relative inline-flex transition-transform active:scale-95 has-[input:active]:scale-95">
                <HapticTapTarget
                  label="Verwenden (Fotos)"
                  onTap={onUsePhotos}
                  disabled={uploading || done}
                />
                <button
                  onClick={onUsePhotos}
                  disabled={uploading || done}
                  aria-label="Verwenden"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black disabled:opacity-60"
                >
                  <span
                    className={`material-symbols-outlined text-[26px] ${uploading ? "animate-spin" : ""}`}
                  >
                    {done ? "check_circle" : uploading ? "progress_activity" : "check"}
                  </span>
                </button>
              </span>
              <span className="text-[11px] text-white/70">
                {done ? "Fertig" : uploading ? "Lädt…" : "Verwenden"}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Clip aufgenommen: verwerfen oder hochladen — flankierende Rundbuttons.
// (Der Live-/Recording-Auslöser lebt jetzt im UnifiedShutter.)
function RecordedControls({
  cam,
  uploadStatus,
  uploadError,
  onUseClip,
}: {
  cam: ReturnType<typeof useCamera>;
  uploadStatus: "idle" | "uploading" | "done" | "error";
  uploadError: string | null;
  onUseClip: () => void;
}) {
  const uploading = uploadStatus === "uploading";
  const done = uploadStatus === "done";
  return (
    <div className="flex flex-col items-center gap-3">
      {uploadError && <p className="text-center text-sm text-red-400">{uploadError}</p>}
      <div className="flex items-end justify-center gap-10">
        <div className="flex flex-col items-center gap-1.5">
          <span className="relative inline-flex transition-transform active:scale-95 has-[input:active]:scale-95">
            <HapticTapTarget
              label="Neu aufnehmen"
              onTap={cam.retake}
              disabled={uploading || done}
            />
            <button
              onClick={cam.retake}
              disabled={uploading || done}
              aria-label="Neu aufnehmen"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/12 text-white disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[24px]">replay</span>
            </button>
          </span>
          <span className="text-[11px] text-white/70">Neu</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <span className="relative inline-flex transition-transform active:scale-95 has-[input:active]:scale-95">
            <HapticTapTarget
              label="Verwenden (Video)"
              onTap={onUseClip}
              disabled={uploading || done}
            />
            <button
              onClick={onUseClip}
              disabled={uploading || done}
              aria-label="Verwenden"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black disabled:opacity-60"
            >
              <span
                className={`material-symbols-outlined text-[28px] ${uploading ? "animate-spin" : ""}`}
              >
                {done ? "check_circle" : uploading ? "progress_activity" : "check"}
              </span>
            </button>
          </span>
          <span className="text-[11px] text-white/70">
            {done ? "Fertig" : uploading ? "Lädt…" : "Verwenden"}
          </span>
        </div>
      </div>
    </div>
  );
}
