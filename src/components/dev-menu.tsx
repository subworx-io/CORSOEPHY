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
}

const ACTIONS: DevAction[] = [
  {
    key: "draw",
    rpc: "dev_menu_draw_story",
    label: "Stadt-Story jetzt ziehen",
    icon: "movie",
    desc: "Zieht sofort aus den echten, heute geposteten und für die Stadt-Story freigegebenen Clips eine neue Auswahl (gewichtete Zufallsziehung) und friert sie stadtweit ein — ohne bis 20:00 zu warten.",
    warn: "Überschreibt die heutige Stadt-Story für ALLE Nutzer.",
  },
  {
    key: "clear",
    rpc: "dev_menu_clear_story",
    label: "Stadt-Story zurücksetzen",
    icon: "backspace",
    desc: "Löscht die heutige Stadt-Story-Auswahl. Die Story-Seite zeigt danach den Leerzustand, bis wieder gezogen wird.",
    warn: "Leert die heutige Stadt-Story für ALLE Nutzer.",
    danger: true,
  },
  {
    key: "expire",
    rpc: "dev_menu_expire_my_follows",
    label: "Meine Follows verfallen lassen",
    icon: "heart_broken",
    desc: "Markiert alle deine aktiven Follows als verfallen — simuliert den 08:00-Reset nur für dich. Deine „Ich folge\"-Liste leert sich.",
    danger: true,
  },
  {
    key: "seed",
    rpc: "dev_menu_seed_test_clips",
    label: "Fake-Test-Clips seeden",
    icon: "science",
    desc: "Legt synthetische Test-Clips mit verschiedenen Follower-Zahlen an, damit du die gewichtete Ziehung solo testen kannst.",
    warn: "Diese Fake-Clips können in der ECHTEN Story auftauchen, bis du sie mit „Fake-Test-Daten löschen\" wieder entfernst.",
    danger: true,
  },
  {
    key: "cleartest",
    rpc: "dev_menu_clear_test_clips",
    label: "Fake-Test-Daten löschen",
    icon: "delete_sweep",
    desc: "Entfernt alle synthetischen Test-Konten samt ihrer Posts, Follows und Story-Slots wieder.",
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
        const { data, error } = await supabase.rpc(action.rpc);
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
                    onClick={() => setPending(a)}
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
                    disabled={running}
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
