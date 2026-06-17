import { createFileRoute } from "@tanstack/react-router";

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
  return (
    <div className="relative h-dvh w-full flex flex-col items-center justify-center bg-neutral-950 text-white">
      <div className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6 font-medium">
        Aufnahme
      </div>
      <p className="text-white/40 text-sm">Live-Kamera & Prompt — coming soon</p>
    </div>
  );
}
