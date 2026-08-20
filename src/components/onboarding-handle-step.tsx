import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

// Handle-Validierung: 2–30 Zeichen, Kleinbuchstaben/Zahlen/Punkt/Unterstrich.
// Identisch zur ursprünglichen Regel in HandleScreen (auth-gate.tsx) — hierher
// extrahiert, damit Onboarding-Flow UND Fallback-HandleScreen dieselbe Logik
// teilen (kein Drift, 1 Gesicht = 1 Handle).
export const HANDLE_RE = /^[a-z0-9._]{2,30}$/;

/**
 * Wiederverwendbarer Handle-Wahl-Schritt (createProfile + Validierung +
 * Fehler-Mapping). Rendert nur das Formular — Screen-Chrome (Hintergrund,
 * Zentrierung) stellt der Aufrufer. So kann derselbe Schritt sowohl im
 * atmosphärischen Onboarding-Flow als auch im nüchternen Fallback-Screen
 * stehen.
 *
 * `onDone` feuert erst nach erfolgreichem createProfile. Der Aufrufer
 * entscheidet, was danach passiert (Flow weiterschalten bzw. nichts — dann
 * rendert das AuthGate durch das jetzt vorhandene Profil weiter).
 */
export function OnboardingHandleStep({ onDone }: { onDone?: () => void }) {
  const { createProfile } = useAuth();
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
      return;
    }
    // Erfolg: das AuthGate hat jetzt ein Profil. onDone erlaubt dem Flow, den
    // Abschluss-Screen zu zeigen, bevor das Profil das Gate durchschaltet.
    onDone?.();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
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
  );
}
