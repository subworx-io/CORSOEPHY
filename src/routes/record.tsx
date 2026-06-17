import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

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

  return (
    <div
      className="relative h-dvh w-full flex flex-col bg-neutral-950 text-white px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
      }}
    >
      {/* Prompt des Tages */}
      <div className="text-center px-2">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/40 font-medium">
          Prompt des Tages
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight leading-snug">
          {DAILY_PROMPT}
        </h1>
      </div>

      {/* Live-Kamera-Fläche (Platzhalter) */}
      <div
        className="relative mt-6 flex-1 rounded-[2rem] overflow-hidden flex flex-col items-center justify-center gap-3"
        style={{
          background: "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.05), transparent 65%), linear-gradient(160deg, #141414 0%, #080808 100%)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset",
        }}
      >
        <div className="w-20 h-20 rounded-full bg-white/8 border border-white/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-white/30 text-[40px]">photo_camera</span>
        </div>
        <p className="text-white/40 text-sm">Live-Kamera — coming soon</p>
        <p className="text-white/25 text-xs">Kein Galerie-Upload, keine Filter.</p>
      </div>

      {/* Einwilligung Stadt-Story + Auslöser */}
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
          <span
            className={`relative w-11 h-6 rounded-full transition-colors ${cityStory ? "bg-white" : "bg-white/20"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${cityStory ? "left-[22px] bg-black" : "left-0.5 bg-white"}`}
            />
          </span>
        </button>

        <button
          disabled
          className="w-full flex items-center justify-center gap-2 py-4 rounded-full bg-white/15 text-white/40 text-sm font-semibold cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[20px]">radio_button_checked</span>
          Moment aufnehmen
        </button>
      </div>
    </div>
  );
}
