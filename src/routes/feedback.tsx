import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "Dashboard — Korso" },
      { name: "description", content: "Deine Reichweite im Rückblick." },
    ],
  }),
  component: FeedbackPage,
});

function FeedbackPage() {
  return (
    <div className="relative h-dvh w-full flex flex-col items-center justify-center bg-neutral-950 text-white">
      <div className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6 font-medium">
        Dashboard
      </div>
      <p className="text-white/40 text-sm">Morgendliche Reichweite — coming soon</p>
    </div>
  );
}
