import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";

// ⚠️ PILOT-PROVISORIUM: Meldungen für fehlgeschlagenes Einlösen eines Einladungs-Links
// (E-Mail-freier Freundes-Pilot). Die Einlöse-Route leitet bei Fehlern auf
// /?invite_error=<code> zurück. Siehe src/lib/invites/server.ts.
const INVITE_ERRORS: Record<string, string> = {
  invalid: "Dieser Einladungs-Link ist ungültig.",
  expired: "Dieser Einladungs-Link ist abgelaufen. Bitte Maxim um einen neuen.",
  used: "Dieser Einladungs-Link wurde bereits benutzt.",
  error: "Beim Einlösen ist etwas schiefgelaufen. Bitte versuch es später noch einmal.",
};

function useInviteError(): string | null {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite_error");
    if (code && INVITE_ERRORS[code]) setMsg(INVITE_ERRORS[code]);
  }, []);
  return msg;
}

/**
 * Auth-Gate: entscheidet, was der Nutzer sieht.
 *   loading            → neutraler Splash (SSR-sicher)
 *   keine Session      → Magic-Link-Login (Onboarding Screen 1)
 *   Session ohne Profil→ Handle-Wahl (1 Gesicht = 1 Handle)
 *   sonst              → die App
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();

  if (loading) return <Splash />;
  if (!session) return <LoginScreen />;
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
  return (
    <div className="flex h-dvh items-center justify-center bg-neutral-950">
      <span className="text-2xl font-semibold tracking-tight text-white/90">Corso</span>
    </div>
  );
}

function LoginScreen() {
  const { signInWithMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const inviteError = useInviteError();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    const { error } = await signInWithMagicLink(email.trim());
    if (error) {
      setError(error);
      setStatus("idle");
    } else {
      setStatus("sent");
    }
  }

  if (status === "sent") {
    return (
      <Screen>
        <h1 className="text-2xl font-semibold tracking-tight">Check deine Mails</h1>
        <p className="mt-3 text-sm text-white/60">
          Wir haben dir einen Login-Link an <span className="text-white">{email}</span> geschickt.
          Öffne ihn auf diesem Gerät.
        </p>
      </Screen>
    );
  }

  return (
    <Screen>
      <h1 className="text-3xl font-semibold tracking-tight">Corso</h1>
      <p className="mt-2 text-sm text-white/60">Deine Stadt. Jeden Abend.</p>

      {inviteError && (
        <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          {inviteError}
        </div>
      )}

      <form onSubmit={submit} className="mt-8 space-y-3">
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
          disabled={status === "sending"}
          className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition-opacity disabled:opacity-50"
        >
          {status === "sending" ? "Senden…" : "Login-Link schicken"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      <p className="mt-6 text-center text-xs text-white/40">
        Mit dem Login bestätigst du, dass du 18+ bist.
      </p>
    </Screen>
  );
}

const HANDLE_RE = /^[a-z0-9._]{2,30}$/;

function HandleScreen() {
  const { createProfile, signOut } = useAuth();
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = handle.trim().toLowerCase().replace(/^@/, "");
  const valid = HANDLE_RE.test(clean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("2–30 Zeichen: Kleinbuchstaben, Zahlen, Punkt oder Unterstrich.");
      return;
    }
    setError(null);
    setSaving(true);
    const { error } = await createProfile(clean);
    if (error) {
      // unique_violation → Handle vergeben
      setError(
        error.includes("duplicate") || error.includes("unique")
          ? "Dieser Handle ist schon vergeben."
          : error,
      );
      setSaving(false);
    }
  }

  return (
    <Screen>
      <h1 className="text-2xl font-semibold tracking-tight">Wähl deinen Handle</h1>
      <p className="mt-2 text-sm text-white/60">
        Ein Gesicht, ein Handle. So findet dich deine Stadt.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-4 focus-within:border-white/30">
          <span className="text-white/40">@</span>
          <input
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="dein.name"
            value={handle.replace(/^@/, "")}
            onChange={(e) => setHandle(e.target.value)}
            className="w-full bg-transparent py-3 pl-1 text-white placeholder:text-white/30 outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !valid}
          className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition-opacity disabled:opacity-50"
        >
          {saving ? "Speichern…" : "Los geht's"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      <button
        onClick={() => void signOut()}
        className="mt-6 w-full text-center text-xs text-white/40 hover:text-white/60"
      >
        Abmelden
      </button>
    </Screen>
  );
}
