import { useEffect, useRef, useState } from "react";
import type { CircleMessage } from "@/lib/supabase/types";

// Darstellung eines Chat-Anhangs in der Nachrichtenblase.
//
// Bewusst NICHT die Feed-Kacheln (photo-stack / video-tile / sequence-media):
// die sind Vollbild-Optik mit Stapel, Auto-Advance und Sequenz-Logik. Eine
// Chat-Blase ist klein, steht in einer Liste und hat keinen Fortschritt.
//
// Video: `preload="metadata"` und Abspielen erst auf Tipp — kein Standbild
// (Entscheidung Dominik, 9. Sep 2026). Damit kostet ein Chat voller Videos beim
// Öffnen nichts außer ein paar Kilobyte Metadaten.

const mmss = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Höhe der Blase aus dem Seitenverhältnis — verhindert Springen beim Laden. */
function ratioStyle(m: Pick<CircleMessage, "width" | "height">) {
  if (!m.width || !m.height) return { aspectRatio: "4 / 5" };
  return { aspectRatio: `${m.width} / ${m.height}` };
}

export function ChatAttachment({
  message,
  url,
  mine,
  onOpenPhoto,
}: {
  message: CircleMessage;
  /** Signierte URL; solange sie fehlt, steht ein ruhiger Platzhalter. */
  url: string | undefined;
  mine: boolean;
  onOpenPhoto?: (url: string) => void;
}) {
  if (message.kind === "voice") {
    return <VoiceBubble url={url} durationMs={message.duration_ms ?? 0} mine={mine} />;
  }

  if (!url) {
    return (
      <div
        className="w-[62vw] max-w-[16rem] animate-pulse rounded-xl bg-white/10"
        style={ratioStyle(message)}
      />
    );
  }

  if (message.kind === "photo") {
    return (
      <button
        onClick={() => onOpenPhoto?.(url)}
        className="block w-[62vw] max-w-[16rem] overflow-hidden rounded-xl"
        style={ratioStyle(message)}
        aria-label="Foto ansehen"
      >
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      </button>
    );
  }

  return <VideoBubble url={url} message={message} />;
}

function VideoBubble({ url, message }: { url: string; message: CircleMessage }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  return (
    <div
      className="relative w-[62vw] max-w-[16rem] overflow-hidden rounded-xl bg-black/40"
      style={ratioStyle(message)}
    >
      <video
        ref={ref}
        src={url}
        playsInline
        preload="metadata"
        controls={playing}
        className="h-full w-full object-cover"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {!playing && (
        <button
          onClick={() => void ref.current?.play()}
          className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors active:bg-black/40"
          aria-label="Video abspielen"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
            <span
              className="material-symbols-outlined text-white text-[26px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              play_arrow
            </span>
          </span>
        </button>
      )}
      {!playing && message.duration_ms ? (
        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] tabular-nums text-white/90">
          {mmss(message.duration_ms)}
        </span>
      ) : null}
    </div>
  );
}

function VoiceBubble({
  url,
  durationMs,
  mine,
}: {
  url: string | undefined;
  durationMs: number;
  mine: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setPositionMs(el.currentTime * 1000);
    const onEnd = () => {
      setPlaying(false);
      setPositionMs(0);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [url]);

  const total = durationMs || 1;
  const progress = Math.min(1, positionMs / total);
  const fg = mine ? "bg-black/70" : "bg-white/80";
  const bg = mine ? "bg-black/20" : "bg-white/25";
  const text = mine ? "text-black/50" : "text-white/50";

  // Feste Balkenhöhen — sieht aus wie eine Waveform, kostet aber nichts. Eine
  // echte Analyse pro Nachricht wäre für den Pilot verschwendete Rechenzeit.
  const bars = [5, 9, 14, 8, 17, 11, 6, 13, 18, 9, 12, 7, 15, 10, 6, 12, 8, 14, 9, 5];

  return (
    <div className="flex items-center gap-2.5">
      {url && <audio ref={ref} src={url} preload="metadata" className="hidden" />}
      <button
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (el.paused) {
            void el.play();
            setPlaying(true);
          } else {
            el.pause();
            setPlaying(false);
          }
        }}
        disabled={!url}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          mine ? "bg-black/10" : "bg-white/15"
        } active:scale-95 transition-transform disabled:opacity-40`}
        aria-label={playing ? "Sprachnachricht pausieren" : "Sprachnachricht abspielen"}
      >
        <span
          className={`material-symbols-outlined text-[20px] ${mine ? "text-black" : "text-white"}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {playing ? "pause" : "play_arrow"}
        </span>
      </button>

      <div className="flex min-w-[7.5rem] flex-col gap-1">
        <div className="flex h-5 items-center gap-[2px]">
          {bars.map((h, i) => (
            <div
              key={i}
              className={`w-[2px] rounded-full ${i / bars.length <= progress ? fg : bg}`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        <span className={`text-[10px] tabular-nums ${text}`}>
          {mmss(playing || positionMs > 0 ? total - positionMs : total)}
        </span>
      </div>
    </div>
  );
}
