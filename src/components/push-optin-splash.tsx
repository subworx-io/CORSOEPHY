import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { usePush } from "@/hooks/use-push";
import { corsoDay } from "@/lib/corso-day";

/*
 * Aufforderung, Push einzuschalten — beim App-Öffnen, nicht beim Login.
 *
 * Grund: die Pilot-Nutzer bleiben dauerhaft eingeloggt. Ein Onboarding-Schritt
 * am Login würde sie nie wieder erreichen, obwohl genau sie es sind, die den
 * 21:00-Push brauchen.
 *
 * Diese Komponente hält außerdem den Startabgleich des Push-Abos am Laufen
 * (usePush() unten) und ersetzt damit die frühere PushSync-Komponente.
 *
 * Häufigkeit: höchstens einmal pro Corso-Zyklus. „Später" ist bewusst möglich —
 * eine Sackgasse ohne Ausweg würde iOS-Nutzer, die einmal ablehnen, dauerhaft
 * gegen eine Wand laufen lassen, und der Systemdialog kommt danach nie wieder.
 * Wer ablehnt, wird am nächsten Abend erneut gefragt.
 */

const STORAGE_KEY = "corso_push_optin_seen";
// Erst nach dem täglichen Prompt-Splash (3 s + Ausblenden) auftauchen —
// zwei Vollbilder übereinander wären nur Lärm.
const DELAY_MS = 4500;

export function PushOptinSplash() {
  const { status, busy, enable } = usePush();
  const { updateProfile } = useAuth();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Merker erst clientseitig lesen — im Cloudflare-Worker gibt es kein localStorage.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === corsoDay()) setDismissed(true);
    } catch {
      // Privater Modus o. ä.: dann eben jedes Mal fragen.
    }
  }, []);

  function remember() {
    try {
      localStorage.setItem(STORAGE_KEY, corsoDay());
    } catch {
      // ignorieren — der Merker ist Komfort, keine Bedingung
    }
    setDismissed(true);
  }

  async function allow() {
    // Muss die erste Anweisung im Tap-Handler sein: iOS verwirft die
    // Berechtigungsabfrage, wenn davor ein await steht.
    const { error } = await enable();
    if (error) {
      toast.error(error);
      remember();
      return;
    }
    const result = await updateProfile({ push_enabled: true });
    if (result.error) {
      toast.error("Konnte nicht gespeichert werden.");
      return;
    }
    toast.success("Push ist an. Wir sehen uns um 21:00.");
    remember();
  }

  if (!ready || dismissed) return null;
  // "on" = alles gut. "blocked" = nur noch über die Systemeinstellungen
  // umkehrbar, ein Fenster würde daran nichts ändern. "unsupported"/"loading"
  // = nichts zu holen.
  if (status !== "off" && status !== "needs-install") return null;

  const needsInstall = status === "needs-install";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/80 backdrop-blur-xl px-6 pb-10 pt-20">
      <div className="mx-auto w-full max-w-sm">
        <span className="material-symbols-outlined text-[40px] leading-none text-white/90">
          {needsInstall ? "ios_share" : "notifications_active"}
        </span>

        <h2 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-white">
          {needsInstall ? "Corso gehört auf deinen Home-Bildschirm" : "Verpass den Abend nicht"}
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-white/60">
          {needsInstall ? (
            <>
              Auf dem iPhone kann Corso dich nur erreichen, wenn die App auf dem Home-Bildschirm
              liegt. Unten auf <span className="text-white/85">Teilen</span> tippen, dann{" "}
              <span className="text-white/85">Zum Home-Bildschirm</span>. Danach Corso von dort
              öffnen.
            </>
          ) : (
            <>
              Um 21:00 geht deine Stadt gemeinsam spazieren — und der neue Prompt startet. Ohne
              Benachrichtigung erfährst du davon nichts.
            </>
          )}
        </p>

        {needsInstall ? (
          <button
            type="button"
            onClick={remember}
            className="mt-8 h-12 w-full rounded-full bg-white text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Verstanden
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={allow}
              className="mt-8 h-12 w-full rounded-full bg-white text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-60"
            >
              {busy ? "Einen Moment…" : "Benachrichtigungen erlauben"}
            </button>
            <button
              type="button"
              onClick={remember}
              className="mt-3 h-11 w-full text-sm text-white/40 transition-colors hover:text-white/70"
            >
              Später
            </button>
          </>
        )}
      </div>
    </div>
  );
}
