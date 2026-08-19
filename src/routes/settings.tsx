import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useBlocks } from "@/lib/blocks/use-blocks";
import { Switch } from "@/components/ui/switch";
import type { Profile } from "@/lib/supabase/types";
import { usePush } from "@/hooks/use-push";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Einstellungen — Corso" },
      {
        name: "description",
        content: "Benachrichtigungen, Sicherheit, Rechtliches und dein Konto.",
      },
    ],
  }),
  component: SettingsPage,
});

const NAME_MAX = 40;

function SettingsPage() {
  const { user, profile } = useAuth();

  if (!user || !profile) {
    return (
      <div
        className="relative flex h-dvh w-full flex-col items-center justify-center bg-neutral-950 px-8 text-center"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}
      >
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
          <span className="material-symbols-outlined text-[36px] text-white/25">lock</span>
        </div>
        <p className="max-w-[16rem] text-sm leading-snug text-white/40">
          Melde dich an, um deine Einstellungen zu sehen.
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative h-dvh w-full overflow-y-auto bg-neutral-950 text-white"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 7rem)",
      }}
    >
      <div className="mx-auto max-w-[600px] px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>

        <div className="mt-8 space-y-10">
          <NotificationsSection profile={profile} />
          <SecuritySection />
          <LegalSection />
          <AccountSection profile={profile} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Bausteine                                                              */
/* ---------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.3em] text-white/40">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        {children}
      </div>
    </section>
  );
}

/* 1. Benachrichtigungen ------------------------------------------------- */

/*
 * Zwei Dinge müssen zusammenkommen, damit ein Push ankommt:
 *   profiles.push_enabled  — die Absicht des Nutzers (0014)
 *   ein Eintrag in push_subscriptions — die Erlaubnis dieses Geräts (0016)
 *
 * Der Switch steht deshalb nur auf „an", wenn beides stimmt. Sie können
 * auseinanderlaufen — iOS wirft das Abo weg, wenn die PWA neu installiert
 * wird. Diesen Fall benennen wir, statt ihn zu verschlucken: sonst glaubt
 * jemand, Push sei an, und wundert sich still über die Stille um 21:00.
 */

function NotificationsSection({ profile }: { profile: Profile }) {
  const { updateProfile } = useAuth();
  const { status, busy, enable, disable } = usePush();
  const [wanted, setWanted] = useState(profile.push_enabled);
  const [saving, setSaving] = useState(false);

  const on = status === "on" && wanted;
  // Die Absicht steht, aber genau dieses Gerät hört nicht zu.
  const staleOnThisDevice = wanted && (status === "off" || status === "blocked");

  async function toggle(next: boolean) {
    setSaving(true);
    // Reihenfolge ist Absicht: erst das Abo (auf iOS muss die Berechtigungs-
    // abfrage am Fingertipp hängen), erst danach die Präferenz speichern.
    const { error } = next ? await enable() : await disable();

    if (error) {
      setSaving(false);
      toast.error(error);
      return;
    }

    setWanted(next);
    const result = await updateProfile({ push_enabled: next });
    setSaving(false);

    if (result.error) {
      setWanted(!next);
      toast.error("Konnte nicht gespeichert werden.");
    }
  }

  return (
    <Section title="Benachrichtigungen">
      <div className="flex items-center justify-between gap-4 px-4 py-4">
        <div>
          <p className="text-sm font-medium">Push-Benachrichtigungen</p>
          <p className="mt-0.5 text-xs leading-snug text-white/40">
            {status === "blocked"
              ? "In den Einstellungen deines Geräts für Corso erlauben."
              : staleOnThisDevice
                ? "Auf diesem Gerät gerade nicht aktiv — einmal aus- und wieder einschalten."
                : "Um 21:00, wenn deine Stadt spazieren geht."}
          </p>
        </div>
        <Switch
          checked={on}
          disabled={saving || busy || status === "loading" || status === "blocked"}
          onCheckedChange={toggle}
          aria-label="Push-Benachrichtigungen"
          className="data-[state=checked]:bg-white data-[state=unchecked]:bg-white/20"
        />
      </div>

      {/* 🔒 iOS lässt Web Push ausschließlich aus der installierten PWA zu.
          Ohne diesen Hinweis bleibt der Switch für iPhone-Nutzer wirkungslos
          und unerklärlich — das ist der Regelfall im Düsseldorfer Pilot. */}
      {status === "needs-install" && (
        <div className="border-t border-white/5 px-4 py-4">
          <p className="text-xs leading-relaxed text-white/60">
            Damit Corso dich abends erreicht, muss die App auf dem Home-Bildschirm liegen: unten auf{" "}
            <span className="text-white/80">Teilen</span> tippen, dann{" "}
            <span className="text-white/80">Zum Home-Bildschirm</span>. Danach Corso von dort öffnen
            und hier einschalten.
          </p>
        </div>
      )}

      {status === "unsupported" && (
        <div className="border-t border-white/5 px-4 py-4">
          <p className="text-xs leading-relaxed text-white/60">
            Dieser Browser kann keine Push-Benachrichtigungen. Auf dem Handy funktioniert es.
          </p>
        </div>
      )}
    </Section>
  );
}

/* 2. Sicherheit --------------------------------------------------------- */

function SecuritySection() {
  const { blocked, unblock } = useBlocks();

  return (
    <Section title="Sicherheit">
      <div className="px-4 py-4">
        <p className="text-sm font-medium">Blockierte Personen</p>
        {blocked.length === 0 ? (
          <p className="mt-2 text-xs leading-snug text-white/40">
            Noch keine blockierten Personen.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {blocked.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm">{p.handle}</span>
                <button
                  onClick={() => void unblock(p.id)}
                  className="text-xs font-medium text-white/60 transition hover:text-white active:scale-95"
                >
                  Entsperren
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

/* 3. Rechtliches -------------------------------------------------------- */

function LegalSection() {
  return (
    <Section title="Rechtliches">
      <div className="divide-y divide-white/5">
        <LegalLink to="/impressum" label="Impressum" />
        <LegalLink to="/datenschutz" label="Datenschutz" />
        <LegalLink to="/agb" label="AGB" />
      </div>
    </Section>
  );
}

function LegalLink({ to, label }: { to: "/impressum" | "/datenschutz" | "/agb"; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-4 px-4 py-4 transition active:bg-white/[0.04]"
    >
      <span className="text-sm">{label}</span>
      <span className="material-symbols-outlined text-[20px] leading-none text-white/30">
        chevron_right
      </span>
    </Link>
  );
}

/* 4. Account ------------------------------------------------------------ */

function AccountSection({ profile }: { profile: Profile }) {
  const { updateProfile, signOut } = useAuth();
  const [name, setName] = useState(profile.display_name ?? "");
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const current = profile.display_name ?? "";
  const changed = trimmed !== current;
  const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;
  const canSave = changed && valid && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const { error } = await updateProfile({ display_name: trimmed });
    setSaving(false);
    if (error) {
      toast.error("Speichern fehlgeschlagen. Versuch es nochmal.");
    } else {
      toast.success("Anzeigename gespeichert.");
    }
  }

  return (
    <Section title="Account">
      {/* Anzeigename — einziges frei editierbares Textfeld der App. */}
      <div className="border-b border-white/5 px-4 py-4">
        <label htmlFor="display-name" className="text-sm font-medium">
          Anzeigename
        </label>
        <div className="mt-3 flex items-center gap-2">
          <input
            id="display-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dein Anzeigename"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
          <button
            onClick={save}
            disabled={!canSave}
            className="shrink-0 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition disabled:opacity-30"
          >
            {saving ? "…" : "Speichern"}
          </button>
        </div>
        <p className="mt-2 text-xs text-white/30">
          Dein @handle bleibt gleich. Max. {NAME_MAX} Zeichen.
        </p>
      </div>

      {/* Abmelden — beendet die Supabase-Session; das AuthGate zeigt danach
          automatisch den Login-Screen (Session = null). */}
      <button
        onClick={() => void signOut()}
        className="flex w-full items-center justify-between gap-4 border-b border-white/5 px-4 py-4 text-left transition active:bg-white/[0.04]"
      >
        <span className="text-sm">Abmelden</span>
        <span className="material-symbols-outlined text-[20px] leading-none text-white/30">
          logout
        </span>
      </button>

      {/* Konto löschen — PILOT-PROVISORIUM: bewusst KEINE Self-Service-Löschung.
          Löschung erfolgt manuell auf Zuruf per E-Mail. */}
      <div className="px-4 py-4">
        <p className="text-sm font-medium">Konto löschen</p>
        <p className="mt-1 text-xs leading-relaxed text-white/40">
          Schreib uns an{" "}
          <a
            href="mailto:contact@subworx.io?subject=Konto%20l%C3%B6schen"
            className="text-white/70 underline underline-offset-2 hover:text-white"
          >
            contact@subworx.io
          </a>{" "}
          — wir löschen dein Konto und alle dazugehörigen Daten.
        </p>
      </div>
    </Section>
  );
}
