import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { OnboardingHandleStep } from "@/components/onboarding-handle-step";

// Client-seitiger „Onboarding gesehen"-Merker. Kein Server-Merker (🔒): rein
// lokal pro Gerät. Wert "v1" erlaubt eine spätere erzwungene Re-Show-Option
// (z.B. bei größerem Flow-Umbau) ohne alten Merker-Kollision.
const ONBOARDING_KEY = "corso_onboarding_seen";
const ONBOARDING_VALUE = "v1";

/**
 * Liefert `null` solange der Client localStorage noch nicht gelesen hat
 * (pending/SSR — wie phase:"pending" im Prompt-Splash), danach `boolean`.
 * SSR-sicher: try/catch um localStorage (privater Modus → als „gesehen"
 * behandeln, damit der Flow keine Sackgasse baut).
 */
function useOnboardingSeen(): { seen: boolean | null; markSeen: () => void } {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setSeen(localStorage.getItem(ONBOARDING_KEY) === ONBOARDING_VALUE);
    } catch {
      // localStorage nicht verfügbar → Flow überspringen (keine Sackgasse).
      setSeen(true);
    }
  }, []);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_KEY, ONBOARDING_VALUE);
    } catch {
      /* ignorieren */
    }
    setSeen(true);
  }, []);

  return { seen, markSeen };
}

// ⚠️ PILOT-PROVISORIUM: Meldungen für fehlgeschlagenes Einlösen eines Einladungs-Links
// (E-Mail-freier Freundes-Pilot). Die Einlöse-Route leitet bei Fehlern auf
// /?invite_error=<code> zurück. Siehe src/lib/invites/server.ts.
const INVITE_ERRORS: Record<string, string> = {
  invalid: "Dieser Einladungs-Link ist ungültig.",
  expired: "Dieser Einladungs-Link ist abgelaufen. Bitte Maxim um einen neuen.",
  used: "Dieser Einladungs-Link wurde bereits benutzt.",
  error: "Beim Einlösen ist etwas schiefgelaufen. Bitte versuch es später noch einmal.",
};

// Bei `error` schickt die Einlöse-Route zusätzlich `why=<stelle>` mit. Ohne diese
// Auffächerung sähen alle vier Ursachen identisch aus und der Flow scheitert still —
// Maxim müsste die Cloudflare-Logs mitschneiden, um überhaupt etwas zu erfahren.
const INVITE_ERROR_WHY: Record<string, string> = {
  nokey: "Der Server findet seinen Zugangsschlüssel nicht (Cloudflare-Secret fehlt).",
  dbread: "Der Server konnte den Link nicht in der Datenbank nachschlagen.",
  claim: "Der Server konnte den Link nicht als benutzt markieren.",
  link: "Der Server konnte kein Login für diese E-Mail erzeugen.",
};

type InviteError = { message: string; why: string | null; detail: string | null };

function useInviteError(): InviteError | null {
  const [state, setState] = useState<InviteError | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("invite_error");
    if (!code || !INVITE_ERRORS[code]) return;
    const why = params.get("why");
    setState({
      message: INVITE_ERRORS[code],
      why: why ? (INVITE_ERROR_WHY[why] ?? why) : null,
      detail: params.get("detail"),
    });
  }, []);
  return state;
}

/**
 * Auth-Gate: entscheidet, was der Nutzer sieht.
 *   loading                 → neutraler Splash (SSR-sicher)
 *   keine Session           → Magic-Link-Login (Onboarding Screen 1)
 *   Onboarding-Merker pending→ Splash (bis localStorage clientseitig gelesen)
 *   Onboarding ungesehen    → First-Run-Flow (Erklär-Screens + Handle + Nudge)
 *   Session ohne Profil     → Handle-Wahl (Fallback: Merker gesetzt, kein Profil)
 *   sonst                   → die App
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  const { seen, markSeen } = useOnboardingSeen();

  if (loading) return <Splash />;
  if (!session) return <LoginScreen />;
  // Solange der Client localStorage noch nicht gelesen hat: Splash statt
  // Flackern des Flows (Hydration-sicher, Prompt-Splash-Muster).
  if (seen === null) return <Splash />;
  // Ungesehen → First-Run. Der Merker wird beim ABSCHLUSS gesetzt (markSeen),
  // nicht beim Anzeigen — ein Abbruch vor dem Ende wiederholt den Flow.
  if (!seen) return <OnboardingFlow onComplete={markSeen} />;
  // Fallback: Merker gesetzt, aber kein Profil (neues Gerät / geleerter
  // Speicher). Der nüchterne Handle-Screen fängt das ab.
  if (!profile) return <HandleScreen />;
  return <>{children}</>;
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-neutral-950 px-8 text-white">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Splash() {
  // Letzte Rückfalllinie: Der Splash darf nie eine Sackgasse sein. Dauert er
  // ungewöhnlich lange, bekommt der Nutzer einen sichtbaren Ausweg statt eines
  // stummen schwarzen Screens.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-neutral-950">
      <span className="text-2xl font-semibold tracking-tight text-white/90">Corso</span>
      {stuck && (
        <button
          onClick={() => window.location.reload()}
          className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/60 transition-colors hover:text-white/90"
        >
          Neu laden
        </button>
      )}
    </div>
  );
}

function LoginScreen() {
  const { requestLoginCode, verifyLoginCode } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // "email" = Adresse eingeben, "code" = 6-stelligen Code aus der Mail eintippen.
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const inviteError = useInviteError();

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await requestLoginCode(email.trim());
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setCode("");
    setStep("code");
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await verifyLoginCode(email.trim(), code);
    setBusy(false);
    // Erfolg braucht kein setState: onAuthStateChange setzt die Session, das
    // AuthGate rendert daraufhin die App.
    if (error) setError(error);
  }

  // --- Schritt 2: Code eingeben ---------------------------------------------
  // Der Code ist auf dem iPhone der einzige Weg, der zuverlässig funktioniert:
  // eine Home-Bildschirm-App hat einen eigenen Speicher, ein angetippter Link
  // öffnet aber immer in Safari — die Session landet dann am falschen Ort.
  if (step === "code") {
    return (
      <Screen>
        <h1 className="text-2xl font-semibold tracking-tight">Code eingeben</h1>
        <p className="mt-3 text-sm text-white/60">
          Wir haben dir einen 6-stelligen Code an <span className="text-white">{email}</span>{" "}
          geschickt. Tipp ihn hier ein — dann bleibst du auf diesem Gerät eingeloggt.
        </p>

        <form onSubmit={submitCode} className="mt-8 space-y-3">
          <input
            type="text"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            // Code-Länge steht in Supabase (Auth → mailer_otp_length, aktuell 6).
            // Bis 8 zulassen, damit eine spätere Umstellung dort die App nicht still bricht.
            maxLength={8}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-white placeholder:text-white/20 outline-none focus:border-white/30"
          />
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition-opacity disabled:opacity-50"
          >
            {busy ? "Prüfen…" : "Einloggen"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>

        <div className="mt-6 flex items-center justify-between text-xs text-white/40">
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setError(null);
              setResent(false);
            }}
            className="transition-colors hover:text-white/70"
          >
            ← Andere E-Mail
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              await sendCode();
              setResent(true);
            }}
            className="transition-colors hover:text-white/70 disabled:opacity-50"
          >
            {resent ? "Nochmal geschickt ✓" : "Code erneut schicken"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-white/30">
          In der Mail steht auch ein Link. Auf dem iPhone funktioniert der Code besser — ein Link
          öffnet in Safari und loggt dich dort ein, nicht hier.
        </p>
      </Screen>
    );
  }

  // --- Schritt 1: E-Mail ----------------------------------------------------
  return (
    <Screen>
      <h1 className="text-3xl font-semibold tracking-tight">Corso</h1>
      <p className="mt-2 text-sm text-white/60">Deine Stadt. Jeden Abend.</p>

      {inviteError && (
        <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <p>{inviteError.message}</p>
          {inviteError.why && <p className="mt-2 text-xs text-amber-200/70">{inviteError.why}</p>}
          {inviteError.detail && (
            <p className="mt-1 font-mono text-[11px] break-words text-amber-200/50">
              {inviteError.detail}
            </p>
          )}
        </div>
      )}

      <form onSubmit={sendCode} className="mt-8 space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="deine@email.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 outline-none focus:border-white/30"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition-opacity disabled:opacity-50"
        >
          {busy ? "Senden…" : "Code schicken"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      <p className="mt-6 text-center text-xs text-white/40">
        Mit dem Login bestätigst du, dass du 18+ bist.
      </p>
    </Screen>
  );
}

// Fallback-Handle-Screen: greift nur, wenn der Onboarding-Merker gesetzt ist,
// aber kein Profil existiert (neues Gerät / geleerter Speicher). Nutzt denselben
// extrahierten Schritt wie der Onboarding-Flow → keine Duplikat-Logik/-Drift.
function HandleScreen() {
  const { signOut } = useAuth();
  return (
    <Screen>
      <h1 className="text-2xl font-semibold tracking-tight">Wähl deinen Handle</h1>
      <p className="mt-2 text-sm text-white/60">
        Ein Gesicht, ein Handle. So findet dich deine Stadt.
      </p>

      <div className="mt-8">
        <OnboardingHandleStep />
      </div>

      <button
        onClick={() => void signOut()}
        className="mt-6 w-full text-center text-xs text-white/40 hover:text-white/60"
      >
        Abmelden
      </button>
    </Screen>
  );
}
