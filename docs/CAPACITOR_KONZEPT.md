# Konzept: Corso als native App über Capacitor

> **Status:** Konzept zur Diskussion (20. Okt 2026) — **noch keine Entscheidung, noch kein Code.**
> Review durch Maxim und Dominik, danach ggf. Start mit Phase N0 (Spike).
>
> **Konflikt mit dem PRD:** PRD §9 und Entscheidung #5 schließen eine native App für den Pilot
> aus („PWA ✓, native App nicht für Pilot"). Dieses Dokument ist die Vorlage, um genau diese
> Entscheidung neu zu treffen. Wird sie getroffen, wird das PRD (v0.8) nachgezogen — vorher
> wird nichts gebaut.

---

## 0. TL;DR

- **Ziel:** Mehr Reichweite für den Prototyp — Corso im App Store und bei Google Play, ohne die
  PWA aufzugeben und ohne die UI neu zu schreiben.
- **Weg:** [Capacitor](https://capacitorjs.com) packt die **bestehende** Web-App in eine native
  Hülle (WKWebView auf iOS, Android System WebView). **Alle Komponenten, Hooks und Routen bleiben
  dieselben.** Native Fähigkeiten kommen punktuell über Plugins dazu.
- **Warum nicht React Native:** RN würde die komplette UI (~8.100 Zeilen Komponenten + Routen,
  der gerade erst gebaute native Feed-Scroll, die Kamera) neu verlangen und PWA und App in zwei
  UIs spalten. Capacitor verlangt das nicht.
- **Was die native App besser kann als die PWA:**
  1. **Push auf dem iPhone ohne „Zum Home-Bildschirm"** — heute der größte Trichter-Verlust.
  2. **Haptik bei Gesten** (Folgen per Quer-Wisch, Einrasten) — in der iOS-PWA technisch
     unmöglich (siehe `src/lib/haptics.ts`).
  3. **Auffindbarkeit** im Store, ein echtes App-Icon, kein Safari-Umweg beim Onboarding.
- **Aufwand:** grob **4–5 Wochen** für eine Person bis zur Store-Einreichung, davon ~1 Woche
  Store-Vorbereitung (Rechtstexte, Konto-Löschung, Listing). Plus Review-Wartezeit.
- **Größte offene Punkte:** Bezahl-Modell vs. In-App-Kauf-Pflicht, Update-Strategie
  (Store-Release vs. Live-Update), Store-Pflicht zur Konto-Löschung in der App.

---

## 1. Ziel und Nicht-Ziel

**Ziel**

- Eine Codebasis, drei Ausgaben: PWA (wie heute, SSR auf Cloudflare), iOS-App, Android-App.
- Native App ist für Nutzer **gleichwertig oder besser** als die PWA — nie schlechter.
- Alle 🔒 Leitplanken gelten unverändert und bleiben serverseitig erzwungen.

**Nicht-Ziel**

- Kein React-Native-Umbau, keine zweite UI.
- Keine neuen Produkt-Features. Was native neu möglich wird (z. B. Haptik bei Gesten), ist eine
  eigene Produktentscheidung (§7).
- Kein Offline-Modus, kein Medien-Cache — Momente leben 24 h und dürfen nirgends überleben
  (gleiche Regel wie in `public/sw.js`).

---

## 2. Warum Capacitor

| Kriterium | PWA (heute) | **Capacitor** | React Native (Expo) |
|---|---|---|---|
| Wiederverwendung der UI | 100 % | **~100 %** | Logik ja, UI neu (~8.100 Z.) |
| Feed-Scroll (CSS Scroll Snap, `docs/SCROLL_NATIV_UMBAU.md`) | ✓ | **✓ identisch** — WKWebView = WebKit, Android = Chromium | neu mit FlatList/Reanimated |
| Live-Kamera (`use-camera.ts`) | ✓ getUserMedia | **✓ getUserMedia im WebView** (Spike nötig, §5 N0) | neu mit vision-camera |
| Push auf iOS | nur nach Home-Bildschirm-Installation | **✓ nativ (APNs)** | ✓ nativ |
| Haptik bei Gesten auf iOS | ✗ unmöglich | **✓ `@capacitor/haptics`** | ✓ |
| Store-Präsenz | ✗ | **✓** | ✓ |
| Aufwand | — | **Wochen** | Monate |
| Risiko | — | WebView-Eigenheiten (Kamera, Autoplay) | Zwei UIs auseinanderlaufend |

React Native lohnt sich erst, wenn der Spike (§5 N0) zeigt, dass der WebView bei Kamera oder
Feed **nachweislich** nicht reicht. Dann ist die Logikschicht (`src/lib/`) die Brücke.

---

## 3. Zielarchitektur

```
                       ┌─────────────────────────────── eine Codebasis (src/) ───┐
                       │  Routen · Komponenten · Hooks · lib/  (unverändert)     │
                       │  + src/lib/native/  ← dünne Plattform-Weiche (neu)      │
                       └──────────┬──────────────────────────────┬───────────────┘
                                  │ vite build (SSR, wie heute)  │ vite build --mode native (SPA)
                                  ▼                              ▼
              ┌────────────────────────────────┐   ┌──────────────────────────────────┐
              │ Cloudflare Pages / Worker      │   │ dist/native  →  npx cap sync      │
              │  · SSR für die PWA             │   │  ┌────────────┐  ┌─────────────┐ │
              │  · /invite/<token>             │   │  │ ios/ (Xcode)│  │ android/    │ │
              │  · /c/<token>, /circle-join/…  │   │  │ WKWebView   │  │ WebView     │ │
              │  · apple-app-site-association  │   │  └────────────┘  └─────────────┘ │
              │  · assetlinks.json             │   │  Plugins: App, Haptics, Push,    │
              └───────────────┬────────────────┘   │  Preferences, StatusBar, Keyboard│
                              │                    └───────────────┬──────────────────┘
                              ▼                                    ▼
              ┌──────────────────────────────────────────────────────────────────────┐
              │ Supabase (unverändert): Auth · Postgres+RLS · Storage · Realtime ·    │
              │ pg_cron · Edge Function send-push  (+ APNs/FCM neben Web Push)        │
              └──────────────────────────────────────────────────────────────────────┘
```

**Grundsätze**

1. **Gebündelt, nicht ferngeladen.** Die App lädt ihren Code aus dem App-Paket (`webDir`), nicht
   per `server.url` von `corso-app.pages.dev`. Eine reine „Website im Rahmen" fällt bei Apple
   unter Guideline 4.2 (Minimum Functionality) durch und wäre offline nicht einmal startbar.
2. **Der Worker bleibt der Worker.** Die drei service_role-Pfade (`/invite`, `/c`, `/circle-join`)
   laufen weiter auf Cloudflare. Die App ruft sie über HTTPS bzw. landet über Universal Links.
   Der service_role-Key kommt **nie** in das App-Paket.
3. **Eine Plattform-Weiche, nicht viele `if`s.** Alles Native geht durch `src/lib/native/`
   (z. B. `isNative()`, `nativeHaptic()`, `registerNativePush()`). Komponenten fragen nie selbst
   nach der Plattform.
4. **Web-Bundle ohne Native-Ballast.** Die Capacitor-Plugins sind in der PWA No-ops bzw. werden
   per dynamischem `import()` nur nativ geladen.

**Bauliche Voraussetzung, die schon erfüllt ist:** Die App nutzt **keine** TanStack-Server-
Functions (`createServerFn` kommt im Code nicht vor). Alles Serverseitige sind die drei
Worker-Pfade in `src/server.ts`. Damit ist ein reiner SPA-Build ohne Funktionsverlust möglich.

---

## 4. Bestandsaufnahme: was bleibt, was sich ändert

| Bereich | Datei(en) | Native-Änderung |
|---|---|---|
| Feeds, Sequenz, Corso, Circle-UI | `use-snap-scroll.ts`, `use-moment-sequence.ts`, `discovery-feed.tsx`, `following-feed.tsx`, `story.tsx`, `circle.tsx` | **keine** — Scroll Snap läuft im WebView mit derselben Engine |
| Live-Kamera 🔒 | `use-camera.ts`, `record.tsx` | **keine im Code**, aber Spike: getUserMedia/MediaRecorder/Zoom im WKWebView verifizieren. `Info.plist`: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`. Android: Kamera-/Mikro-Berechtigung im Manifest |
| Circle-Chat-Galerie (Ausnahme) | `circle-chat.tsx` (`<input type="file">`) | **keine** — öffnet nativ den System-Picker. `NSPhotoLibraryUsageDescription` nötig |
| Sprachnachricht | `use-voice-recorder.ts` | keine, Mikro-Berechtigung wie oben |
| Supabase-Client / Session | `lib/supabase/client.ts`, `auth-context.tsx` | Session-Speicher nativ über `@capacitor/preferences` statt localStorage (iOS kann WebView-Speicher räumen → Nutzer flöge raus) |
| Login | `auth-gate.tsx`, `auth-context.tsx` | 6-stelliger Code funktioniert unverändert und wird nativ **der Hauptweg**. Magic-Link: `emailRedirectTo` auf Universal Link, `appUrlOpen`-Listener übernimmt die Session |
| Einladungs-Links | `server.ts`, `lib/invites/server.ts`, `lib/circle-invites/server.ts` | Worker bleibt. Ziel-Redirect muss in der App landen (§6 Risiko R3) |
| Deep Links `/p/$handle`, `/c/<token>` | Router | Universal Links (iOS) / App Links (Android) → `@capacitor/app` → `router.navigate` |
| Web Push | `use-push.ts`, `push-optin-splash.tsx`, `public/sw.js` | nativ: kein Service Worker, stattdessen `@capacitor/push-notifications`. Zustand `needs-install` entfällt nativ |
| Push-Versand | `supabase/functions/send-push`, `0016_push_subscriptions.sql` | APNs (iOS) + FCM (Android) **zusätzlich** zu VAPID. Neue Migration (§5 N3) |
| Haptik | `lib/haptics.ts`, `haptic-tap.tsx` | nativ `@capacitor/haptics`; der unsichtbare Schalter-Trick wird nativ zum No-op |
| App-Lebenszyklus | `auth-context.tsx` (`visibilitychange`), TanStack Query | `@capacitor/app` `resume` → Queries neu laden (Momente verfallen, während die App im Hintergrund schläft). Android-Zurück-Taste |
| Safe Areas, Statusleiste | `__root.tsx` (`viewport-fit=cover`, `env(safe-area-inset-*)`) | bleibt; `@capacitor/status-bar` für helle Schrift auf dunklem Grund |
| Tastatur im Chat | `circle-chat.tsx` | `@capacitor/keyboard` (Resize-Modus), am Gerät prüfen |
| Lokale Merker | `auth-gate.tsx`, `push-optin-splash.tsx`, `city-story-hit-splash.tsx` | bleiben auf localStorage (Verlust = Splash erscheint erneut, unkritisch) |
| Hintergrund-Clips | `public/empty-bg-*.mp4` (~35 MB) | **nicht** ins App-Paket bündeln, sondern von der Web-Domain/Storage streamen → kleiner Download |
| Dev-Menü | `dev-menu.tsx` | unverändert (serverseitig geprüft) |
| Rechtstexte | `impressum/datenschutz/agb.tsx` | **sind Platzhalter** — für den Store Pflicht (§5 N5) |
| Konto löschen | `settings.tsx` (Z. 368: manuell per E-Mail) | **Store-Pflicht: Löschung in der App anstoßbar** (§5 N5) |

---

## 5. Umsetzungsplan in Phasen

Jede Phase endet mit einem Gerätebeweis, nicht mit „baut". Reihenfolge nach Risiko: was das
ganze Vorhaben kippen kann, kommt zuerst.

### N0 — Spike am Gerät (2–3 Tage) · **Go/No-Go für Capacitor**

Wegwerf-Branch, minimale Hülle mit dem bestehenden Bundle. Am echten iPhone und einem
Mittelklasse-Android prüfen:

| # | Prüfung | Bestanden wenn |
|---|---|---|
| 1 | Foto- und 15-s-Video-Aufnahme in `record.tsx` | Aufnahme mit Ton, Upload, Moment erscheint auf anderem Gerät |
| 2 | Kamera-Zoom (Pinch) und Kamerawechsel | Hardware-Zoom geht oder Digital-Fallback für Fotos greift wie in Safari |
| 3 | Audio-Constraints (kein AGC/Rauschfilter) | Klang wie in Safari, nicht „Telefonat" |
| 4 | Feed-Scroll in allen vier Feeds | gleiche Flüssigkeit wie Safari, `scrollend`/Tipp/Quer-Wisch unverändert |
| 5 | Video-Autoplay inline, stumm, in Kacheln | spielt ohne Tipp, kein Vollbild-Sprung |
| 6 | Login per 6-stelligem Code, App beenden, neu öffnen | Session bleibt |
| 7 | Chat: Galerie-Anhang + Sprachnachricht | System-Picker öffnet, Upload geht |

**Fällt 1–5 durch**, ist Capacitor nicht der Weg → Rückfall auf die React-Native-Option mit
gemeinsamer `src/lib/`-Schicht (eigenes Konzept).

### N1 — Hülle und Build (2–3 Tage)

- Capacitor-Projekt anlegen: `capacitor.config.ts` (App-ID z. B. `io.subworx.corso`), `ios/`
  und `android/` ins Repo.
- Zweiter Build-Modus `bun run build:native`: SPA-Ausgabe (TanStack Start SPA-Modus bzw.
  Client-Build mit Shell-`index.html`) nach `dist/native`. **Im Spike zu verifizieren**, wie
  sich das mit `@lovable.dev/vite-tanstack-config` sauber konfigurieren lässt.
- Env für native: nur `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL`.
  Supabase-Auth: Redirect-URLs um App-Origin (`capacitor://localhost`, `https://localhost`)
  ergänzen.
- `src/lib/native/` mit `isNative()` und Plattform-Weichen; Service-Worker-Registrierung nativ
  überspringen.
- Statusleiste, Splash-Screen, App-Icon (heute gibt es nur `favicon.ico` — wir brauchen ein
  echtes Icon-Set, das auch der PWA zugutekommt).
- Lebenszyklus: `resume` → Query-Invalidierung; Android-Zurück-Taste → Router zurück.

### N2 — Auth, Deep Links, Einladungen (3–4 Tage)

- Session-Speicher über `@capacitor/preferences` (Storage-Adapter für `createClient`).
- `apple-app-site-association` und `.well-known/assetlinks.json` vom Worker ausliefern.
- Universal/App Links für `/p/<handle>`, `/c/<token>`, Auth-Rückkehr.
- Einladungs-Flüsse (`/invite/<token>`, `/c/<token>`) so umbauen, dass sie in der App enden
  (Lösungsoptionen siehe R3).
- Ohne installierte App funktioniert jeder Link **wie heute** in der PWA — das ist die Rückfall-
  ebene und darf nicht brechen.

### N3 — Nativer Push (4–5 Tage)

- Neue Migration `0037_native_push.sql` (append-only): `push_subscriptions` um `platform`
  (`web` | `ios` | `android`) und `device_token` erweitern; `p256dh`/`auth` nur für `web`
  Pflicht (Check-Constraint). `types.ts` nachziehen.
- `send-push`: Versand nach Plattform verzweigen — Web Push (wie heute), APNs (HTTP/2, JWT mit
  `.p8`-Schlüssel), FCM HTTP v1 (Service Account). Neue Secrets in der Edge Function, nie im
  Client. Bestehende `dedupe_key`-Logik über `corso_day()` bleibt unverändert.
- `use-push.ts`: nativer Zweig über `@capacitor/push-notifications`; Berechtigungs-Dialog
  weiterhin erst auf Fingertipp (gleiche UX wie heute).
- Tipp auf Benachrichtigung → `url` aus der Nutzlast → Router.
- Negativtest: ein Gerät mit Web- **und** App-Abo bekommt jeden Push nur einmal
  (Entscheidung, welches Abo gewinnt: §7 E5).

### N4 — Native Feinheiten (2–3 Tage)

- `lib/haptics.ts`: nativer Zweig mit `@capacitor/haptics`. **Erst mal nur 1:1 dort, wo es heute
  auf Android schon vibriert.** Haptik bei Gesten auf iOS ist eine Produktentscheidung (E6).
- Tastatur im Chat (`@capacitor/keyboard`), Safe Areas im Notch/Dynamic-Island-Fall.
- Hintergrund-Clips streamen statt bündeln.
- Security-Smoke-Tests (`scripts/security-test-*.mjs`) gegen den unveränderten Backend-Stand —
  sie müssen ohne Änderung grün bleiben, weil sich serverseitig nichts an den Leitplanken ändert.

### N5 — Store-Bereitschaft (~1 Woche + Review)

- **Konto-Löschung in der App** (Apple 5.1.1(v), Google Play Pflicht): Self-Service-Löschung
  über Edge Function bzw. SQL-Funktion mit Bestätigung. Heute bewusst manuell — muss ersetzt
  werden.
- **Rechtstexte** Impressum, Datenschutz, AGB/Nutzungsbedingungen final (heute Platzhalter).
  Datenschutz um App-spezifische Punkte ergänzen (Push-Token, Gerätekennung).
- **Nutzergenerierte Inhalte** (Apple 1.2): Melden/Blockieren ist da (`moment-menu.tsx`, `0017`).
  Zusätzlich nötig: Zustimmung zu Nutzungsbedingungen im Onboarding, dokumentierter
  Moderationsweg (Reaktion auf Meldungen binnen 24 h).
- **Altersfreigabe:** Dating-Ausgang + UGC → Fragebögen ehrlich ausfüllen, voraussichtlich 17+
  (iOS) / „Ab 18" klären.
- Privacy Nutrition Label (Apple) und Data-Safety-Formular (Google).
- Listing: Screenshots, Texte (Deutsch), Support-URL, Demo-Zugang für den Review
  (Login-Code-Mail an Reviewer-Konto oder fester Test-Account).
- Verteilung zuerst über **TestFlight** und **Google Play Internal Testing** an den
  Freundes-Pilot, dann öffentlich.

### Gesamtaufwand

| Phase | Aufwand |
|---|---|
| N0 Spike | 2–3 T |
| N1 Hülle & Build | 2–3 T |
| N2 Auth & Deep Links | 3–4 T |
| N3 Push | 4–5 T |
| N4 Feinheiten | 2–3 T |
| N5 Store | ~5 T + Review-Wartezeit |
| **Summe** | **~4–5 Wochen** (1 Person) |

Nicht eingerechnet: Wartezeit auf Apple-Developer-Account (bei Organisationen D-U-N-S-Nummer,
kann Tage bis Wochen dauern — **sofort beantragen, falls Go**).

---

## 6. Risiken

| # | Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|---|
| R1 | getUserMedia/MediaRecorder im WKWebView verhalten sich anders als in Safari (Zoom, Audio, Formate) | Kern-Mechanik kaputt | N0-Spike zuerst. Fallback: natives Kamera-Vorschau-Plugin (weiterhin **nur live**, kein Galerie-Pfad) |
| R2 | Video-Autoplay/Inline im WebView | Feed fühlt sich tot an | Capacitor-iOS-Config (`allowsInlineMediaPlayback`) prüfen, N0 #5 |
| R3 | Einladungs-Link → Worker-Redirect → Magic-Link: Universal Links greifen bei serverseitigen Redirects in Safari oft **nicht** | Neue Nutzer landen in der PWA statt in der App | Landeseite mit sichtbarem „In der App öffnen"-Tipp (Nutzer-Tipp löst Universal Link aus) oder Login per Code statt Magic-Link in der App |
| R4 | Versionsdrift: alte App-Version im Feld vs. neue Migrationen | Abstürze/Fehler bei Nutzern, die nicht updaten | Migrationen rückwärtskompatibel halten; `app_config.min_native_version` + „Bitte aktualisieren"-Screen |
| R5 | Apple lehnt ab (4.2 Minimum Functionality, 1.2 UGC, 5.1.1 Konto-Löschung) | Wochen Verzug | N5 vollständig vor Einreichung; native Mehrwerte (Push, Haptik, Kamera) im Review-Hinweis nennen |
| R6 | Abo €9/Monat in der App = In-App-Kauf-Pflicht (Apple 3.1.1, Google) | 15–30 % Gebühr, StoreKit-Integration, Preismodell wackelt | Entscheidung E2 vor dem Fremden-Pilot; Freundes-Pilot ist gratis → kein Problem |
| R7 | iOS räumt WebView-Speicher | Nutzer unerwartet ausgeloggt | Session in `@capacitor/preferences` (N2) |
| R8 | Zwei Push-Wege pro Person (PWA + App) | doppelte Benachrichtigungen | Dedupe pro Nutzer statt pro Abo, E5 |

---

## 7. Offene Entscheidungen (für Maxim und Dominik)

| # | Frage | Optionen | Empfehlung |
|---|---|---|---|
| **E1** | Native App jetzt — PRD §9/#5 kippen? | ja / nein / erst nach Freundes-Pilot | ja, mit N0-Spike als Go/No-Go |
| **E2** | Bezahlung im Fremden-Piloten, wenn die App im Store ist | In-App-Kauf (StoreKit/Play Billing) / Bezahlung nur im Web + App ohne Kauf-Hinweis / Pilot gratis | Pilot-Phase gratis halten; IAP erst entscheiden, wenn zahlender Pilot startet |
| **E3** | Update-Strategie | nur Store-Releases / Live-Updates des Web-Bundles (z. B. Capgo, Appflow, selbst gehostet) | Store-Releases zum Start; Live-Updates evaluieren, sobald die Release-Frequenz nervt |
| **E4** | Plattformen | iOS zuerst / beide gleichzeitig | beide — der Mehraufwand für Android ist gering, Testgerät nötig |
| **E5** | Nutzer hat PWA **und** App | beide bekommen Push / App gewinnt | App gewinnt, Web-Abo wird beim nativen Opt-in stillgelegt |
| **E6** | Haptik bei Gesten (Folgen per Wisch, Einrasten) jetzt auch auf iOS | ja / weiter nur Tipps | ja — ist heute nur technisch, nicht produktseitig gesperrt |
| **E7** | Store-Konten | unter subworx (Organisation) / privat | Organisation (Firmenname im Store, D-U-N-S) |
| **E8** | App-Name/Bundle-ID | „Corso", `io.subworx.corso` | Markenrecht/Namensverfügbarkeit im Store vorher prüfen |
| **E9** | Konto-Löschung Self-Service | harte Löschung / Soft-Delete mit Frist | harte Löschung, wie heute manuell, nur selbst ausgelöst |

---

## 8. 🔒 Leitplanken-Check

| Leitplanke | Wirkung durch Capacitor |
|---|---|
| Live-Kamera-Pflicht, keine Filter | unverändert — derselbe `use-camera.ts`. **`@capacitor/camera` wird bewusst nicht installiert** (bietet einen Galerie-Pfad). Ein nativer Fallback (R1) darf nur Live-Vorschau können |
| Galerie nur im Circle-Chat | unverändert — das einzige `<input type="file">` bleibt in `circle-chat.tsx`, kein Native-Picker-Plugin |
| Follower-Zahlen unsichtbar | serverseitig, unberührt |
| Kein Publikums-Verfall durch Zahlung verlängerbar | unberührt; gilt auch für jeden In-App-Kauf (E2) |
| Einwilligung pro Moment für den Stadt Corso | unberührt |
| Circle-Schwelle/Zähler unsichtbar | unberührt |
| service_role nicht im Client | bleibt im Worker; das App-Paket enthält nur den anon key |
| Momente 24 h, nirgends gecacht | kein Medien-Cache im App-Paket; Hintergrund-Clips sind keine Momente |

---

## 9. Neue Abhängigkeiten (Freigabe nötig)

Laut CLAUDE.md keine neuen Pakete ohne Rückfrage — mit Go zu E1 würden diese dazukommen:

| Paket | Zweck |
|---|---|
| `@capacitor/core`, `@capacitor/cli` | Laufzeit + Build-Werkzeug |
| `@capacitor/ios`, `@capacitor/android` | native Projekte |
| `@capacitor/app` | Deep Links, `resume`, Zurück-Taste |
| `@capacitor/push-notifications` | APNs/FCM-Token, Push-Empfang |
| `@capacitor/haptics` | Haptik |
| `@capacitor/preferences` | dauerhafte Session |
| `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/keyboard` | native Feinheiten |

Bewusst **nicht**: `@capacitor/camera`, `@capacitor/filesystem` (kein Galerie-/Datei-Pfad für
Momente). `package-lock.json` **und** `bun.lock` nachziehen (siehe CLAUDE.md, Release-Workflow
fährt `npm ci`).

Werkzeuge: Xcode (macOS) für iOS-Builds, Android Studio. CI für native Builds (macOS-Runner,
Fastlane) erst nach dem ersten Store-Release — bis dahin lokal bauen.

---

## 10. Nach der Entscheidung

1. PRD auf v0.8 heben (§9, Entscheidung #5, Out-of-Scope-Liste), ROADMAP um die Phasen N0–N5,
   STATUS aktualisieren.
2. Apple-Developer-Programm (Organisation) und Google-Play-Konsole beantragen.
3. N0-Spike starten.
