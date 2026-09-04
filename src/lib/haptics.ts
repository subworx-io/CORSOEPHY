/**
 * Haptisches Feedback in der PWA.
 *
 * ## Was auf dem iPhone wirklich geht (am Gerät gemessen, 4. September 2026)
 *
 * Safari kennt `navigator.vibrate` nicht. Der einzige Web-Zugang zur Taptic
 * Engine ist ein `<input type="checkbox" switch>`. Der verbreitete Trick,
 * so ein Element versteckt anzulegen und per `label.click()` auszulösen,
 * **funktioniert nicht mehr** — auf Dominiks Gerät gegen sechs Varianten
 * getestet:
 *
 *   ✓ Finger TIPPT auf einen sichtbaren Schalter     → Impuls
 *   ✓ Finger TIPPT auf einen unsichtbaren Schalter (opacity:0) über der Fläche → Impuls
 *   ✓ dasselbe mit opacity 0.02, mit appearance:none, als 44×44-Fläche    → Impuls
 *   ✗ derselbe Schalter per Code geklickt            → nichts
 *   ✗ quer über den Schalter GEWISCHT                → nichts
 *   ✗ quer gewischt, während die Kachel dem Finger folgt → nichts
 *   ✗ hoch/runter gewischt (wie beim Scrollen)       → nichts
 *
 * Die Regel daraus: **Es zählt der echte Fingertipp auf das Schalter-Element.**
 * Unsichtbar darf es sein, synthetisch nicht — und gewischt zählt nicht als
 * Tipp, auch nicht über einem Schalter, der sich nativ ziehen ließe.
 *
 * ## Folgen für den Aufbau
 *
 *  - **Android/Chrome:** `haptic()` mit `navigator.vibrate` — funktioniert für
 *    alles, auch für Gesten (Wischen, Einrasten).
 *  - **iOS/Safari:** `haptic()` kann dort nichts ausrichten und steigt sofort
 *    aus. Haptik gibt es nur an Tipp-Zielen, und zwar über die Komponenten in
 *    `src/components/haptic-button.tsx`, die ein unsichtbares Schalter-Element
 *    unter den Finger legen.
 *  - **Gesten auf iOS:** nicht erreichbar — am Gerät gegengeprüft, nicht
 *    vermutet. Folgen und Entfolgen per Wisch, das Einrasten zwischen Momenten:
 *    dort bleibt das iPhone stumm. Wer das ändern will, braucht ein Tipp-Ziel,
 *    also eine Produktentscheidung, keine technische.
 *
 * Haptik ist damit erst recht Beigabe, nie Träger einer Information: Sie fehlt
 * auf dem Desktop, sie fehlt bei Gesten auf iOS, und sie fehlt, wenn die
 * Systemhaptik in den Geräte-Einstellungen aus ist.
 */

export type Haptic =
  /** Rasterpunkt — Feed rastet ein, Wisch-Schwelle erreicht. Kleinster Reiz. */
  | "tick"
  /** Kurze Bestätigung — Foto ausgelöst, Aufnahme beendet. */
  | "tap"
  /** Etwas beginnt — Video-Aufnahme läuft los. */
  | "impact"
  /** Es hat geklappt — Folgen, Erneuern, Circle-Eintritt. */
  | "success"
  /** Sanfter Widerspruch — Entfolgen, Abbruch. */
  | "warning"
  /** Es ging schief — Upload fehlgeschlagen, Kamera verweigert. */
  | "error";

// Android: Millisekunden bzw. Vibration/Pause-Muster.
const ANDROID_PATTERN: Record<Haptic, number | number[]> = {
  tick: 4,
  tap: 10,
  impact: 18,
  success: [12, 40, 24],
  warning: [18, 70, 18],
  error: [26, 50, 26, 50, 26],
};

const STORAGE_KEY = "corso.haptics";
// Ticks kommen beim schnellen Wischen im Dutzend — sonst staut sich die
// Vibration und läuft der Geste hinterher.
const TICK_MIN_GAP_MS = 60;

let enabled: boolean | null = null;
let lastTickAt = 0;
let switchSupport: boolean | null = null;

/** Ist die Haptik vom Nutzer eingeschaltet? (Default: ja) */
export function hapticsEnabled(): boolean {
  if (enabled !== null) return enabled;
  if (typeof window === "undefined") return false;
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    enabled = true;
  }
  return enabled;
}

/** Schalter für die Einstellungen — merkt sich die Wahl pro Gerät. */
export function setHapticsEnabled(next: boolean) {
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    /* Private Mode o. Ä. — dann gilt die Wahl nur für diese Sitzung. */
  }
}

/** Kann dieses Gerät Muster vibrieren (Android)? */
export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

/**
 * Kann dieses Gerät an Tipp-Zielen haptisch antworten (iPhone ab iOS 17.4)?
 * Feature-Detection über die `switch`-Property statt über den User-Agent —
 * sie gibt es genau in den WebKit-Versionen, die den System-Tap liefern.
 */
export function canTapHaptics(): boolean {
  if (switchSupport !== null) return switchSupport;
  if (typeof document === "undefined") {
    switchSupport = false;
    return false;
  }
  switchSupport = "switch" in document.createElement("input");
  return switchSupport;
}

/**
 * Kann das Gerät überhaupt etwas? Für UI-Entscheidungen gedacht (den Schalter
 * in den Einstellungen zeigen oder nicht).
 */
export function hapticsSupported(): boolean {
  return canVibrate() || canTapHaptics();
}

/**
 * Einen haptischen Reiz auslösen — **wirkt nur auf Geräten mit
 * `navigator.vibrate`, praktisch also auf Android.**
 *
 * Auf dem iPhone steigt die Funktion sofort aus, statt wirkungslos ein
 * DOM-Element zu klicken: Der Aufruf steckt an heiklen Stellen (jeder
 * Slide-Wechsel im Snap-Feed, mitten in der Wischgeste), und dort ist Arbeit
 * ohne Wirkung teurer als sie aussieht. Wer auf dem iPhone Haptik will,
 * braucht ein Tipp-Ziel — siehe `HapticButton` / `HapticTapTarget`.
 */
export function haptic(kind: Haptic = "tap") {
  if (!hapticsEnabled()) return;
  if (!canVibrate()) return;
  // Im Hintergrund (anderer Tab, Bildschirm aus) wäre es nur ein Zucken in
  // der Hosentasche.
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

  if (kind === "tick") {
    const now = Date.now();
    if (now - lastTickAt < TICK_MIN_GAP_MS) return;
    lastTickAt = now;
  }

  try {
    navigator.vibrate(ANDROID_PATTERN[kind]);
  } catch {
    /* Manche Browser blocken ohne vorherige Nutzer-Interaktion. */
  }
}

/**
 * Früher nötig, um das versteckte Schalter-Element vorzuwärmen. Seit der
 * Messung vom 4. September gibt es kein verstecktes Element mehr — die
 * Funktion bleibt als No-Op, damit ältere Aufrufstellen nicht brechen.
 *
 * @deprecated Kann bei der nächsten Berührung der Aufrufstelle entfallen.
 */
export function warmUpHaptics() {
  /* absichtlich leer */
}
