/* Corso — Web-Push-Abo im Browser.
 *
 * Verwaltet ausschließlich die *technische* Seite: Berechtigung, Service
 * Worker, PushSubscription und deren Spiegelung in push_subscriptions (0016).
 * Die *Absicht* des Nutzers (profiles.push_enabled) bleibt beim Aufrufer —
 * siehe src/routes/settings.tsx.
 *
 * Leitplattform ist die iPhone-PWA. Daraus folgen zwei Eigenheiten, die hier
 * nicht wegoptimiert werden dürfen:
 *
 *  1. Auf iOS gibt es Web Push NUR aus einer zum Home-Bildschirm hinzugefügten
 *     PWA. Im Safari-Tab existiert `Notification` gar nicht. Deshalb der
 *     eigene Zustand "needs-install" statt eines pauschalen "unsupported".
 *  2. `Notification.requestPermission()` muss im selben Task laufen wie der
 *     Fingertipp. Steht davor ein `await`, verwirft iOS die Anfrage
 *     kommentarlos. Deshalb ist es in enable() die allererste Anweisung.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase/client";

export type PushStatus =
  | "loading" // noch nicht ermittelt (SSR + erster Frame)
  | "needs-install" // iOS im Safari-Tab: erst zum Home-Bildschirm hinzufügen
  | "unsupported" // Browser kann kein Web Push
  | "blocked" // Berechtigung verweigert — nur noch über die Systemeinstellungen umkehrbar
  | "off" // möglich, aber kein Abo
  | "on"; // Abo aktiv

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/** VAPID-Key aus URL-safe Base64 in das von PushManager erwartete Byte-Array. */
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  // Puffer explizit anlegen: sonst tippt TS auf ArrayBufferLike, und
  // applicationServerKey akzeptiert nur eine Sicht auf einen echten ArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** ArrayBuffer → URL-safe Base64, wie der Push-Dienst die Schlüssel erwartet. */
function bufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS meldet sich seit 13 als „MacIntel" — nur maxTouchPoints verrät es.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Läuft die App als installierte PWA (Home-Bildschirm / App-Fenster)? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function canPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Registriert den Worker und wartet, bis er wirklich steuerbereit ist. */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** Abo in push_subscriptions spiegeln. Idempotent — auch der Startabgleich nutzt das. */
async function persist(sub: PushSubscription): Promise<string | null> {
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: bufferToBase64Url(sub.getKey("p256dh")),
    p_auth: bufferToBase64Url(sub.getKey("auth")),
    p_user_agent: navigator.userAgent,
  });
  return error?.message ?? null;
}

export function usePush() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);

  /* Startabgleich. Zwei Fälle, die nur hier auffallen:
   *  — Das Abo existiert noch: last_seen_at auffrischen, damit tote Geräte
   *    später erkennbar sind.
   *  — Die Berechtigung steht, aber das Abo ist weg (iOS wirft es bei
   *    Neuinstallation der PWA weg, ohne den Nutzer zu fragen): still neu
   *    abonnieren. Das braucht keine Geste, solange die Berechtigung steht. */
  useEffect(() => {
    let active = true;

    (async () => {
      if (typeof window === "undefined") return;

      if (!canPush()) {
        if (active) setStatus(isIOS() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setStatus("blocked");
        return;
      }
      if (Notification.permission !== "granted") {
        if (active) setStatus("off");
        return;
      }

      try {
        const reg = await readyRegistration();
        let sub = await reg.pushManager.getSubscription();

        if (!sub && VAPID_PUBLIC_KEY) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        if (sub) await persist(sub);
        if (active) setStatus(sub ? "on" : "off");
      } catch {
        // Kein harter Fehler: der Nutzer kann es im Einstellungen-Screen
        // jederzeit von Hand auslösen.
        if (active) setStatus("off");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  /** Muss direkt aus einem Fingertipp aufgerufen werden (iOS-Bedingung). */
  const enable = useCallback(async (): Promise<{ error?: string }> => {
    if (!canPush()) {
      return {
        error: isIOS()
          ? "Auf dem iPhone geht Push nur aus der installierten App."
          : "Dein Browser unterstützt keine Push-Benachrichtigungen.",
      };
    }
    if (!VAPID_PUBLIC_KEY) {
      return { error: "Push ist noch nicht konfiguriert (VAPID-Schlüssel fehlt)." };
    }

    // ERSTE Anweisung, ohne vorheriges await — sonst verwirft iOS die Anfrage.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "blocked" : "off");
      return { error: "Ohne Erlaubnis kann Corso dich abends nicht erreichen." };
    }

    setBusy(true);
    try {
      const reg = await readyRegistration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      const error = await persist(sub);
      if (error) {
        setStatus("off");
        return { error: "Abo konnte nicht gespeichert werden." };
      }

      setStatus("on");
      return {};
    } catch {
      setStatus("off");
      return { error: "Push konnte nicht eingerichtet werden." };
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<{ error?: string }> => {
    setBusy(true);
    try {
      if (canPush()) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          // Erst aus der DB nehmen, dann lokal abmelden: bricht der zweite
          // Schritt, schicken wir wenigstens nichts mehr an ein totes Abo.
          await supabase.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
      }
      setStatus("off");
      return {};
    } catch {
      return { error: "Abmelden hat nicht geklappt." };
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, enable, disable };
}
