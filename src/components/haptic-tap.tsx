import { useEffect, useRef, useState, type ComponentProps } from "react";
import { canTapHaptics, hapticsEnabled } from "@/lib/haptics";

/**
 * Haptik für Tipp-Ziele auf dem iPhone.
 *
 * Hintergrund steht in `src/lib/haptics.ts`: Auf iOS gibt es einen Impuls nur,
 * wenn ein Finger ein echtes `<input type="checkbox" switch>` trifft. Ein per
 * Code ausgelöster Klick bringt nichts (am Gerät gemessen, 4. Sep 2026).
 *
 * Also legen wir genau so ein Element unsichtbar über das Bedienelement. Der
 * Finger trifft den Schalter, iOS gibt den System-Tap, `onTap` führt die
 * eigentliche Aktion aus. Gemessen wurde: opacity 0 reicht, die Größe ist egal,
 * `appearance:none` schadet nicht.
 *
 * ```tsx
 * <div className="relative">
 *   <button onClick={save}>Verwenden</button>
 *   <HapticTapTarget label="Verwenden" onTap={save} />
 * </div>
 * ```
 *
 * Wichtig für den Aufrufer:
 *  - Der Container braucht `relative`, das Ziel legt sich mit `inset-0` darüber.
 *  - `onTap` muss dasselbe tun wie der `onClick` des Elements darunter — auf
 *    iOS bekommt dieses Element den Tipper nicht mehr.
 *  - Ein `<input>` darf nicht IN einem `<button>` stehen. Deshalb Geschwister
 *    im gemeinsamen Container, nie Kind des Knopfes.
 *  - Auf Android und Desktop rendert die Komponente nichts — dort läuft die
 *    Haptik über `haptic()` im normalen Klick-Handler weiter.
 *  - **Das Rendern IST der Mechanismus.** Es gibt keinen Weg, das Element
 *    stehen zu lassen und nur den Impuls abzuschalten — iOS gibt den System-Tap
 *    beim Berühren. Deshalb verschwindet das Ziel, wenn der Nutzer die Haptik
 *    abschaltet. Wo es einen Klick abfängt (z. B. die BottomNav), wechselt
 *    damit auch der Weg, über den die Aktion läuft; beide Wege müssen stimmen.
 */
export function HapticTapTarget({
  label,
  onTap,
  disabled,
  ignoreSetting,
  className = "",
  ...rest
}: {
  /** Wofür der Tipper steht — nur für die Fehlersuche, das Element ist aria-hidden. */
  label: string;
  onTap: () => void;
  disabled?: boolean;
  /**
   * Auch dann rendern, wenn die Haptik ausgeschaltet ist. Nur für den Schalter
   * in den Einstellungen: Beim Einschalten soll der Impuls sofort beweisen,
   * worum es geht.
   */
  ignoreSetting?: boolean;
} & Omit<ComponentProps<"input">, "type" | "onChange">) {
  // Erst nach dem Mount entscheidbar (der CF-Worker hat kein document), und
  // der Nutzer kann die Haptik in den Einstellungen abgeschaltet haben.
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActive(canTapHaptics() && (ignoreSetting || hapticsEnabled()));
  }, [ignoreSetting]);

  useEffect(() => {
    // `switch` ist kein bekanntes React-Attribut — direkt ans DOM hängen.
    if (active) ref.current?.setAttribute("switch", "");
  }, [active]);

  if (!active || disabled) return null;

  return (
    <input
      ref={ref}
      type="checkbox"
      // Der Knopf darunter trägt die Semantik; für VoiceOver ist dieses
      // Element nur Beiwerk und darf den Fokus nicht abfangen.
      aria-hidden="true"
      tabIndex={-1}
      data-haptic={label}
      onChange={onTap}
      className={`absolute inset-0 z-20 m-0 h-full w-full appearance-none opacity-0 ${className}`}
      {...rest}
    />
  );
}
