import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";

// 🔒 Dev-Menü ist ausschließlich für diesen Account sichtbar UND serverseitig
// (is_dev_admin() in 0006_dev_admin_controls.sql) nochmal abgesichert — die
// Sichtbarkeitsprüfung hier ist nur Bequemlichkeit, nicht die Sicherheitsgrenze.
const DEV_EMAIL = "dominik@subworx.io";

interface DevAction {
  key: string;
  /** Serverseitige Aktion (Supabase-RPC). Entweder rpc ODER run. */
  rpc?: string;
  /** Rein clientseitige Aktion (z.B. UI-Vorschau). Rückgabe-String landet im Toast. */
  run?: () => Promise<string | void> | string | void;
  label: string;
  icon: string;
  /** Was die Aktion tut (im Bestätigungs-Popup gezeigt). */
  desc: string;
  /** Zusätzliche Warnung, falls die Aktion für andere Nutzer sichtbar wirkt. */
  warn?: string;
  danger?: boolean;
  /** Freitext-Felder, die vor dem Ausführen als RPC-Argumente mitgehen. */
  inputs?: DevInput[];
}

/** Ein Eingabefeld im Bestätigungsschritt. `name` ist der RPC-Parametername. */
interface DevInput {
  name: string;
  label: string;
  placeholder: string;
  max: number;
  multiline?: boolean;
}

const ACTIONS: DevAction[] = [
  {
    key: "draw",
    rpc: "dev_menu_draw_story",
    label: "Stadt Corso jetzt ziehen",
    icon: "movie",
    desc: "Zieht sofort aus den echten, heute geposteten und für den Stadt Corso freigegebenen Momenten eine neue Auswahl (gewichtete Zufallsziehung) und friert sie stadtweit ein — ohne bis 21:00 zu warten.",
    warn: "Überschreibt den heutigen Stadt Corso für ALLE Nutzer.",
  },
  {
    key: "clear",
    rpc: "dev_menu_clear_story",
    label: "Stadt Corso zurücksetzen",
    icon: "backspace",
    desc: "Löscht die heutige Auswahl für den Stadt Corso. Der Screen zeigt danach den Leerzustand, bis wieder gezogen wird.",
    warn: "Leert den heutigen Stadt Corso für ALLE Nutzer.",
    danger: true,
  },
  {
    key: "expire",
    rpc: "dev_menu_expire_my_follows",
    label: "Meine Follows verfallen lassen",
    icon: "heart_broken",
    desc: "Zieht den 24h-Verfall aller deiner aktiven Follows sofort vor — ohne 24 Stunden zu warten. Deine „Ich folge\"-Liste leert sich.",
    danger: true,
  },
  {
    key: "expiremoment",
    rpc: "dev_menu_expire_my_moment",
    label: "Meinen Moment verfallen lassen",
    icon: "timer_off",
    desc: "Zieht den 24h-Verfall deines lebenden Moments sofort vor. Danach ist er überall weg: Discovery, „Ich folge\" und Rücklauf. Im laufenden Stadt Corso bleibt er stehen, falls er gezogen wurde.",
    danger: true,
  },
  {
    key: "seed",
    rpc: "dev_menu_seed_test_clips",
    label: "Fake-Test-Momente seeden",
    icon: "science",
    desc: "Legt synthetische Test-Momente mit verschiedenen Follower-Zahlen an, damit du die gewichtete Ziehung solo testen kannst.",
    warn: "Diese Fake-Momente können im ECHTEN Stadt Corso auftauchen, bis du sie mit „Fake-Test-Daten löschen\" wieder entfernst.",
    danger: true,
  },
  {
    key: "cleartest",
    rpc: "dev_menu_clear_test_clips",
    label: "Fake-Test-Daten löschen",
    icon: "delete_sweep",
    desc: "Entfernt alle synthetischen Test-Konten samt ihrer Momente, Follows und Slots im Stadt Corso wieder.",
  },
  {
    key: "broadcast",
    rpc: "dev_menu_broadcast_push",
    label: "Nachricht an alle senden",
    icon: "campaign",
    desc: "Schickt eine selbst geschriebene Push-Benachrichtigung an JEDEN, der Push eingeschaltet hat. Kommt binnen einer Minute an. Tippen darauf öffnet die Discovery.",
    warn: "Geht an alle und landet auf fremden Sperrbildschirmen — dort mitlesbar. Keine Follower- oder Zuschauerzahlen, keine Namen Dritter hineinschreiben.",
    danger: true,
    inputs: [
      { name: "p_title", label: "Titel", placeholder: "Corso", max: 60 },
      {
        name: "p_body",
        label: "Text",
        placeholder: "Heute Abend um 21:00 geht deine Stadt zum ersten Mal spazieren.",
        max: 180,
        multiline: true,
      },
    ],
  },
  {
    key: "testpush",
    rpc: "dev_menu_test_push",
    label: "Test-Push an mich",
    icon: "notifications_active",
    desc: "Schickt sofort eine Push-Benachrichtigung an alle Geräte, auf denen du Push eingeschaltet hast — ohne bis 21:00 zu warten. Kommt binnen einer Minute an. Betrifft nur dich.",
  },
  {
    key: "splash",
    run: () => {
      window.dispatchEvent(new CustomEvent("corso:preview-splash"));
      return "Splash eingeblendet.";
    },
    label: "Prompt-Splash zeigen",
    icon: "slideshow",
    desc: "Blendet den täglichen Vollbild-Prompt-Splash sofort ein (3 Sekunden, genau wie beim ersten App-Öffnen). Reine Vorschau — ändert nichts am „einmal pro Tag\"-Merker und an der DB.",
  },
];

export function DevMenu() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DevAction | null>(null);
  const [running, setRunning] = useState(false);
  // Werte der Freitext-Felder, sofern die gewählte Aktion welche hat.
  const [values, setValues] = useState<Record<string, string>>({});

  // Sicherheitsnetz gegen einen bekannten vaul-Bug: nach dem Schließen des Drawers
  // kann `pointer-events: none` am <body> hängen bleiben → die ganze App reagiert
  // nicht mehr. Nach dem Schließen kurz warten und den Wert sicherheitshalber leeren.
  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => {
      document.body.style.pointerEvents = "";
    }, 500);
    return () => window.clearTimeout(t);
  }, [open]);

  // Nur der Dev-Admin sieht das Menü überhaupt.
  if (user?.email !== DEV_EMAIL) return null;

  async function runAction(action: DevAction) {
    // Rein clientseitige UI-Aktion (z.B. Splash-Vorschau): erst den Drawer sauber
    // schließen, DANN nach der Schließ-Animation ausführen. Sonst erscheint der
    // Splash über dem noch offenen Drawer und vaul kann pointer-events blockieren.
    if (action.run) {
      const run = action.run;
      setPending(null);
      setOpen(false);
      window.setTimeout(() => {
        void Promise.resolve(run()).then((msg) =>
          toast.success(action.label, {
            description: typeof msg === "string" ? msg : "Erledigt.",
          }),
        );
      }, 350);
      return;
    }

    setRunning(true);
    try {
      if (action.rpc) {
        // Felder gehen als benannte Argumente mit; ohne Felder bleibt der
        // Aufruf argumentlos wie bisher.
        const args = action.inputs
          ? Object.fromEntries(action.inputs.map((f) => [f.name, (values[f.name] ?? "").trim()]))
          : undefined;
        const { data, error } = await supabase.rpc(action.rpc, args);
        if (error) {
          toast.error("Fehlgeschlagen", { description: error.message });
        } else {
          toast.success(action.label, {
            description: typeof data === "string" ? data : "Erledigt.",
          });
          // Daten neu laden, damit Story/Follows sich sofort aktualisieren.
          queryClient.invalidateQueries();
        }
      }
    } catch (e) {
      toast.error("Fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
      setPending(null);
      setOpen(false);
    }
  }

  return (
    <>
      {/* Trigger-Pille im Ribbon — Stil wie die inaktiven Tabs */}
      <button
        type="button"
        aria-label="Dev-Menü"
        onClick={() => {
          setPending(null);
          setOpen(true);
        }}
        className="flex items-center justify-center h-10 w-10 rounded-full text-amber-300/80 hover:text-amber-200 transition-all"
      >
        <span className="material-symbols-outlined text-[20px] leading-none">terminal</span>
      </button>

      <Drawer
        modal={false}
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setPending(null);
        }}
      >
        <DrawerContent className="bg-neutral-900 border-white/10 text-white">
          <DrawerHeader className="text-left">
            <DrawerTitle className="flex items-center gap-2 text-amber-300">
              <span className="material-symbols-outlined text-[20px]">terminal</span>
              Dev-Menü
            </DrawerTitle>
            <DrawerDescription className="text-white/50">
              {pending
                ? "Bist du sicher?"
                : "Nur für dich sichtbar. Jede Aktion fragt vor dem Ausführen nach."}
            </DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-8 pt-1">
            {!pending ? (
              /* Schritt 1: Liste der Aktionen */
              <div className="flex flex-col gap-2">
                {ACTIONS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => {
                      setValues({});
                      setPending(a);
                    }}
                    className="flex items-center gap-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-[0.99] transition-all px-4 py-3 text-left"
                  >
                    <span
                      className={`material-symbols-outlined text-[22px] ${
                        a.danger ? "text-red-400" : "text-amber-300"
                      }`}
                    >
                      {a.icon}
                    </span>
                    <span className="text-sm font-medium tracking-tight">{a.label}</span>
                    <span className="material-symbols-outlined text-[18px] text-white/30 ml-auto">
                      chevron_right
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              /* Schritt 2: Bestätigung mit Erklärung */
              <div className="flex flex-col gap-4">
                <div className="rounded-xl bg-white/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`material-symbols-outlined text-[22px] ${
                        pending.danger ? "text-red-400" : "text-amber-300"
                      }`}
                    >
                      {pending.icon}
                    </span>
                    <span className="text-sm font-semibold tracking-tight">{pending.label}</span>
                  </div>
                  <p className="text-sm text-white/70 leading-relaxed">{pending.desc}</p>
                  {pending.warn && (
                    <p className="mt-2 flex items-start gap-1.5 text-sm text-red-300 leading-relaxed">
                      <span className="material-symbols-outlined text-[18px] leading-none mt-0.5">
                        warning
                      </span>
                      {pending.warn}
                    </p>
                  )}
                </div>

                {pending.inputs && (
                  <div className="flex flex-col gap-3">
                    {pending.inputs.map((f) => {
                      const value = values[f.name] ?? "";
                      return (
                        <label key={f.name} className="flex flex-col gap-1.5">
                          <span className="flex items-baseline justify-between text-xs text-white/50">
                            {f.label}
                            <span className={value.length > f.max ? "text-red-400" : ""}>
                              {value.length}/{f.max}
                            </span>
                          </span>
                          {f.multiline ? (
                            <textarea
                              rows={3}
                              value={value}
                              maxLength={f.max}
                              placeholder={f.placeholder}
                              onChange={(e) =>
                                setValues((v) => ({ ...v, [f.name]: e.target.value }))
                              }
                              className="resize-none rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:bg-white/10 transition-colors"
                            />
                          ) : (
                            <input
                              type="text"
                              value={value}
                              maxLength={f.max}
                              placeholder={f.placeholder}
                              onChange={(e) =>
                                setValues((v) => ({ ...v, [f.name]: e.target.value }))
                              }
                              className="rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:bg-white/10 transition-colors"
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => setPending(null)}
                    className="flex-1 h-11 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    disabled={
                      running ||
                      (pending.inputs?.some((f) => (values[f.name] ?? "").trim() === "") ?? false)
                    }
                    onClick={() => runAction(pending)}
                    className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
                      pending.danger
                        ? "bg-red-500 hover:bg-red-400 text-white"
                        : "bg-amber-400 hover:bg-amber-300 text-black"
                    }`}
                  >
                    {running ? "…" : "Ja, ausführen"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
