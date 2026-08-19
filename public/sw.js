/* Corso — Service Worker.
 *
 * Zweck: ausschließlich Push. KEIN Offline-Caching, KEIN Precaching.
 * Momente leben 24 Stunden und sind danach überall weg — ein Cache, der sie
 * überleben lässt, wäre ein Bruch der Kern-Mechanik, kein Feature.
 *
 * Der Worker liegt in public/ und wird unverändert unter /sw.js ausgeliefert.
 * Er darf deshalb kein Bundling, keine Imports und kein TypeScript enthalten.
 */

// Neuer Worker übernimmt sofort statt auf das Schließen aller Tabs zu warten.
// Auf iOS ist die PWA oft tagelang „offen" — sonst käme ein Fix nie an.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* ---------------------------------------------------------------------------
 * push — Nutzlast anzeigen.
 *
 * Der Versender schickt JSON: { title, body, url, tag }.
 * Fällt das Parsen aus (leerer Push, fremdes Format), zeigen wir trotzdem
 * etwas an: iOS entzieht die Push-Berechtigung, wenn ein Push ankommt, ohne
 * dass eine Benachrichtigung erscheint.
 * ------------------------------------------------------------------------ */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Corso";
  const options = {
    body: payload.body || "Deine Stadt geht spazieren.",
    // Gleicher tag → die neue Meldung ersetzt die alte, statt zu stapeln.
    // Ein Nutzer soll nie zehn Corso-Zeilen im Sperrbildschirm finden.
    tag: payload.tag || "corso",
    renotify: true,
    data: { url: payload.url || "/" },
    // iOS ignoriert beides und nimmt das App-Icon; Android nutzt sie.
    icon: "/icon-192.png",
    badge: "/badge-72.png",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ---------------------------------------------------------------------------
 * notificationclick — in die laufende App navigieren statt ein zweites
 * Fenster zu öffnen.
 * ------------------------------------------------------------------------ */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              // Navigation kann fehlschlagen (z. B. anderer Origin im Verlauf) —
              // der Fokus allein ist immer noch das richtige Ergebnis.
            }
          }
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});

/* ---------------------------------------------------------------------------
 * pushsubscriptionchange — bewusst NICHT hier behandelt.
 *
 * Der Worker hat keine Auth-Session (kein localStorage, kein Supabase-Token),
 * könnte das erneuerte Abo also gar nicht der richtigen Person zuordnen.
 * Stattdessen gleicht der Client das Abo bei jedem App-Start gegen die DB ab
 * (siehe src/hooks/use-push.ts). Das deckt denselben Fall ab und ist der
 * einzige Weg, der auf iOS zuverlässig funktioniert.
 * ------------------------------------------------------------------------ */
