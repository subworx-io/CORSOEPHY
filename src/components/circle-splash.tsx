import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CityBackdrop } from "@/components/city-backdrop";
import { useCircle } from "@/lib/circle/use-circle";

// Circle-Eintritt als gefeierter Moment (Umbau-Auftrag 2. Sep 2026): Wenn eine
// neue Verbindung entstanden ist, bekommt der User beim nächsten App-Öffnen eine
// klare, positive Ankündigung — verdient und gefeiert, nicht zufällig.
//
// Der „gesehen"-Stand liegt SERVERSEITIG (connections.announced_a/b_at, RPC
// acknowledge_circle): genau einmal pro Person, nicht einmal pro Gerät.
// 🔒 Es wird bewusst NICHT erklärt, wie viele gegenseitige Tage nötig waren —
// die Schwelle bleibt eine Überraschung.
//
// z-[110]: liegt über dem DailyPromptSplash (z-[100]), falls beide gleichzeitig
// fällig sind — der Prompt-Splash läuft darunter seine 3,5 s ab und ist danach weg.
export function CircleSplash() {
  const { partners, acknowledge } = useCircle();
  const navigate = useNavigate();
  // Lokal ausgeblendete Verbindungen: sofortiges UI-Feedback, während der
  // acknowledge-Roundtrip läuft.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [leaving, setLeaving] = useState(false);

  const next = partners.find((p) => p.unseen && !dismissed.has(p.connectionId));

  // Neue Ankündigung → Einblendung zurücksetzen.
  useEffect(() => {
    if (next) setLeaving(false);
  }, [next?.connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!next) return null;

  const close = (thenChat: boolean) => {
    if (leaving) return;
    setLeaving(true);
    setDismissed((prev) => new Set(prev).add(next.connectionId));
    void acknowledge(next.connectionId);
    if (thenChat) {
      void navigate({ to: "/circle", search: { chat: next.partnerId } });
    }
  };

  const name = next.displayName || next.handle;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-neutral-950 px-8"
      style={{
        opacity: leaving ? 0 : 1,
        transition: "opacity 400ms ease",
        pointerEvents: leaving ? "none" : "auto",
        touchAction: "none",
      }}
      role="dialog"
      aria-label="Neu in deinem Circle"
    >
      <CityBackdrop extraDark />

      <div className="relative z-10 w-full max-w-[22rem] text-center">
        <span className="material-symbols-outlined text-white text-[44px] drop-shadow-[0_2px_20px_rgba(0,0,0,0.7)]">
          celebration
        </span>
        <h1 className="mt-5 font-serif text-[30px] font-medium leading-[1.15] tracking-[-0.01em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          Jemand Neues in deinem Inner Circle
        </h1>
        <p className="mt-4 text-sm leading-snug text-white/70">
          Du und <span className="font-semibold text-white">{name}</span> — ihr habt einander immer
          wieder gewählt. Ab jetzt bleibt ihr verbunden und könnt euch schreiben.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={() => close(true)}
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-transform active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
            Schreib {name}
          </button>
          <button
            onClick={() => close(false)}
            className="rounded-full px-5 py-2 text-sm font-medium text-white/60 transition-colors hover:text-white"
          >
            Später
          </button>
        </div>
      </div>
    </div>
  );
}
