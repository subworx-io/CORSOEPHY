import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "Korso — Verbindungen" },
      { name: "description", content: "Deine gegenseitigen Follows." },
    ],
  }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  return (
    <div className="relative h-dvh w-full flex flex-col items-center justify-center bg-neutral-950 text-white">
      <div className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6 font-medium">
        Korso
      </div>
      <p className="text-white/40 text-sm">Gegenseitige Follows & Chat — coming soon</p>
    </div>
  );
}
