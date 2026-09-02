import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

// Circle-Link einlösen (Ziel von /c/<token> bzw. dem Magic-Link-Verify).
// Diese Route rendert erst HINTER dem AuthGate — wer hier ankommt, ist
// eingeloggt und hat ein Profil (neue Freunde durchlaufen vorher Login/
// Onboarding, die URL bleibt dabei stehen). Die Verbindung stiftet die
// DEFINER-RPC redeem_circle_invite (0026) — Block-Check, Einmal-Verwendung
// und chat_reached-Events passieren serverseitig.

export const Route = createFileRoute("/circle-redeem/$token")({
  head: () => ({
    meta: [{ title: "Circle-Einladung — Corso" }],
  }),
  component: RedeemPage,
});

const FAIL_TEXT: Record<string, string> = {
  invalid: "Dieser Circle-Link ist nicht (mehr) gültig.",
  expired: "Dieser Circle-Link ist abgelaufen — Links gelten 7 Tage.",
  used: "Dieser Circle-Link wurde schon von jemand anderem benutzt.",
  self: "Das ist dein eigener Link — schick ihn einer Freundin oder einem Freund.",
  error: "Das hat gerade nicht geklappt. Versuch es gleich nochmal.",
};

function RedeemPage() {
  const { token } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fail, setFail] = useState<string | null>(null);
  // StrictMode-Doppelmount-Guard: die RPC ist idempotent für den Einlösenden
  // ('connected' beim zweiten Aufruf), aber doppelt feuern muss sie nicht.
  const firedRef = useRef(false);

  useEffect(() => {
    if (!user || firedRef.current) return;
    firedRef.current = true;
    void (async () => {
      const { data, error } = await supabase.rpc("redeem_circle_invite", { p_token: token });
      const status = error ? "error" : ((data as string) ?? "invalid");
      if (status === "connected") {
        // Frische Verbindung sofort sichtbar machen; der CircleSplash feiert
        // den Eintritt (announced bleibt serverseitig ungesetzt).
        await queryClient.invalidateQueries({ queryKey: ["circle"] });
        void navigate({ to: "/circle", search: {}, replace: true });
        return;
      }
      setFail(FAIL_TEXT[status] ?? FAIL_TEXT.error);
    })();
  }, [user, token, navigate, queryClient]);

  return (
    <div className="relative flex h-dvh w-full flex-col items-center justify-center bg-neutral-950 px-8 text-center">
      {fail ? (
        <>
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
            <span className="material-symbols-outlined text-[36px] text-white/25">link_off</span>
          </div>
          <p className="max-w-[18rem] text-sm leading-snug text-white/60">{fail}</p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform active:scale-[0.98]"
          >
            Zur Stadt
          </Link>
        </>
      ) : (
        <>
          <div className="mb-5 h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          <p className="text-sm text-white/55">Circle wird verbunden …</p>
        </>
      )}
    </div>
  );
}
