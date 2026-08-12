# Corso — Status

**Stand:** 16. Juli 2026 (Stadt-Story-Ziehung live + E-Mail-freie Einladungs-Links gebaut & getestet; Aufnahme-Flow verifiziert, Login-Mails im Posteingang → Phase 0 durch, Phase 1 angelaufen; Story-Leerzustand neu gestaltet — atmosphärischer Video-Hintergrund, live; Aufnahme-Screen neu gestaltet — kamera-first, Auto-Start, Stadt-Story-Pille erst nach der Aufnahme; Rücklauf-Screen komplett gebaut — zwei private Kennzahlen Publikum + Zuschauer mit „seit gestern"-Delta, anonyme Ansichten-Erfassung, Migration `0010` live; dein aktueller Moment als Video-Hintergrund mit den Zahlen als ruhigem Overlay; 20:00-Countdown von Discovery auf den Story-Screen verlegt; **Einstellungen-Screen (Screen 10) minimal gebaut & deployed — vier ruhige Blöcke: Push-Präferenz, Blockierte-Platzhalter, Rechts-Links (Impressum/Datenschutz/AGB), Account (Anzeigename ändern / Abmelden / manuelle Kontolöschung). Migration `0014_profile_settings.sql` geschrieben, aber NOCH NICHT angewendet — bis dahin geben Push-Schalter + Namensfeld eine Fehler-Toast.**)

> **📌 Commit-Stand 16. Juli:** Der gesamte unten als „unkommittiert" beschriebene Feature-Batch **inkl. Aufnahme-Redesign, Rücklauf, Story-Countdown und Einstellungen-Screen wird mit diesem Commit versioniert** (die Einzel-„unkommittiert"-Marker unten sind ab hier historisch). Das **gesamte Frontend ist deployed & live** auf `corso-app.pages.dev` (letzter Deploy inkl. Aufnahme-Redesign + Einstellungen). **Einziger offener DB-Schritt:** `0014_profile_settings.sql` anwenden (`node scripts/db-apply.mjs …`), danach funktionieren Push-Präferenz + Anzeigename. Die ~35 MB Hintergrund-Videos `public/empty-bg-*.mp4` werden mit diesem Commit **als normale Dateien ins Repo aufgenommen** (Entscheidung 16. Juli: plain git statt LFS — für den Pilot ausreichend, frische Clones/Deploys funktionieren ohne Zusatzschritt).
**Zweck:** Lebender Schnappschuss. Wer neu in das Projekt einsteigt (Mensch oder Agent), liest das hier zuerst und weiß, wo es steht und was der nächste konkrete Schritt ist. Diese Datei bei jedem nennenswerten Fortschritt aktualisieren.

> Reihenfolge zum Reinkommen: `CLAUDE.md` → `docs/PRD.md` (was & warum) → `docs/ROADMAP.md` (was als nächstes) → **diese Datei** (wo genau stehen wir).

---

## 12. August — Scroll-Verhalten in Discovery/Story/Ich-folge repariert

**Symptom:** Beim Hochwischen wurde kurz noch der bisherige Moment als aktiver gezeigt, bevor er verschwand und der neue kam; der neue wirkte dabei „eingefroren". Zusätzlich beim allerersten Aufruf am Tag ein verrutschtes/klemmendes Scrollen, das sich nach einem Reload gab.

**Ursache 1 — aktiver Index lief der Geste hinterher (`use-snap-scroll.ts`).** `setCurrentIndex()` wurde erst im `else`-Zweig am **Ende** der 380-ms-Snap-Animation gesetzt. `currentIndex` steuert aber `isActive` → welches Video spielt. Während des ganzen Wischens plus Snap lief also noch der alte Moment, während der Ziel-Moment pausiert (= eingefroren) danebenstand. **Fix:** neuer `commitIndex()`, der sofort greift — beim Überqueren der Hälfte während des Wischens (`onMove`) und beim Start von `snapTo`, nicht erst am Ende.

**Ursache 2 — Gesten-Listener hingen global am `window`.** `<DailyPromptSplash/>` ist in `__root.tsx` ein **Geschwister** des Feed-Containers und liegt als `fixed inset-0 z-[100]` darüber (3,5 s, **einmal pro Corso-Tag**). Jeder Wisch darauf steuerte den Feed darunter fern; der Splash selbst blieb stehen. Erklärt exakt „nur beim ersten Aufruf" und „weg nach Reload" — der Splash schreibt seinen localStorage-Merker sofort beim Anzeigen, ein Reload zeigt ihn also nie wieder. **Fix:** neuer `containerRef` aus dem Hook, in allen drei Screens am Feed-Container; Touch/Wheel/Maus-Gesten werden ignoriert, wenn sie außerhalb beginnen. Splash zusätzlich auf `touch-action: none` (verhinderte sonst natives Seiten-Scrollen).

**Ursache 3 (mit erledigt) — Maß aus `window.innerHeight`,** während das Layout `h-dvh` nutzt. Auf dem Handy driften die zwei beim Ein-/Ausfahren der Browser-Leiste auseinander → Slides sitzen um die Leistenhöhe versetzt. **Fix:** Maß aus `containerRef.clientHeight`, plus `ResizeObserver` am Container (erwischt `dvh`-Änderungen zuverlässiger als `resize` am window).

**Nebenwirkung bewusst abgefangen:** Der aktive Index wechselt jetzt früher, also feuerte `recordView` auch für Clips, an denen man nur vorbeizieht — „Zuschauer" ist Kill-Metrik. Deshalb in allen drei Screens eine **500-ms-Verweil-Schwelle** vor dem Verbuchen (`clearTimeout` im Cleanup). Vorbeiziehen zählt damit nicht mehr, Landen weiterhin schon.

⚠️ **Nicht auf einem echten Handy verifiziert** (kein Browser-Tool in der Session) — Typecheck + Build grün, Ursachen 1–3 sind im Code belegt. Offene Restspur, falls es weiter ruckelt: Discovery lädt bis zu 20 `<video>`-Elemente gleichzeitig mit Standard-`preload` — auf Mobilfunk potenziell zäh.

---

## 12. August — Splash-Hänger behoben + Prompt im Rücklauf

**1. Bug: App hing beim ersten Aufruf im „Corso"-Splash** (nur Reload half, auf MacBook wie Mobile). Ursache in `src/lib/auth-context.tsx`, zwei Defekte:
- `supabase.auth.getSession()` hatte **kein `.catch()` und keinen Timeout** — die einzige Stelle, die `loading` aufhebt. Jede Rejection (Netz, Token-Refresh, Storage) = Splash für immer.
- Der `onAuthStateChange`-Callback war **`async` und lud darin das Profil** (wieder ein Supabase-Aufruf). supabase-js ruft den Callback auf, **während der interne Auth-Lock gehalten wird** → Verklemmung mit dem parallelen `getSession()`. Von Supabase ausdrücklich als Anti-Pattern dokumentiert. Erklärt, warum es nur beim *ersten* Aufruf auftrat: da ist der Token meist abgelaufen und muss per Netz erneuert werden — genau der Pfad, der den Lock hält.

**Fix:** Callback synchron, Profil-Laden per `setTimeout(…, 0)` außerhalb des Locks; `try/catch` + 8-s-Timeout um die initiale Session-Prüfung (im Fehlerfall Login statt Sackgasse); neuer `profilePending`-State verhindert Aufblitzen des Handle-Screens; `pendingUserId` als Race-Schutz. `Splash` zeigt nach 10 s einen „Neu laden"-Button als letzte Rückfalllinie. **Deployed & live** (im Bundle verifiziert). ⚠️ Der echte Beweis braucht einen Aufruf **>1 h nach dem letzten Login** (Token-Lebensdauer) — bis dahin nicht abschließend bestätigt.

**2. Rücklauf zeigt jetzt den Prompt, zu dem der Moment entstand** (`feedback.tsx`). Auflösung über `posts.prompt_date` → `daily_prompt.corso_day` → `prompts.text` — `daily_prompt` ist die kanonische Historie. **Bewusst KEIN Rückfall auf `prompts.active_date`**: das ist seit `0013` nur ein LRU-Marker und würde den falschen Prompt zeigen. Ohne Historie wird nichts angezeigt statt etwas Falsches. Darstellung im Editorial-Stil des Aufnahme-Screens (System-Serif, Kursiv-Label) im Kopf über dem Video, mit tagesabhängigem Label „Heute" / „Gestern" / Datum (der Rücklauf zeigt den *neuesten* Moment, der nicht zwingend von heute ist). Gegen die Live-DB verifiziert: PostgREST-Embed funktioniert, **alle** vorhandenen Post-Tage haben Prompt-Historie. Nebenbei die handgepflegten Typen in `supabase/types.ts` nachgezogen (`Prompt.category`/`.active`, neu `DailyPrompt`) — die hingen seit `0011` hinterher.

---

## Wo wir stehen

**Phase:** **Phase 0 — Backend-Fundament** (laufend, siehe `docs/ROADMAP.md`).
**Insgesamt:** Supabase-Backend steht, Auth + Follow-Logik + täglicher Reset live. **Cloudflare-Deployment funktioniert vollständig** — der komplette Flow (Login → Magic-Link → Handle → alle 5 Screens) läuft live auf `https://corso-app.pages.dev`, extern testbar.

**Letzte UI-Politur:**
- **20:00-Countdown auf den Story-Screen verlegt (16. Juli, unkommittiert)** — der Countdown gehört inhaltlich zur Stadt-Story, nicht in die Discovery. **Discovery (`index.tsx`):** Countdown-Slide entfernt → der Feed startet direkt beim ersten Moment (kein Vorbeiwischen mehr am Countdown); zugehöriger Code (`useCountdown`, `nextStoryTarget`, Skyline-Import, `countdown`-Slide-Variante) aufgeräumt. **Story-Screen (`story.tsx`):** Leerzustand (`StoryEmpty`) zeigt jetzt den großen Countdown `Std:Min:Sek` auf die nächste 20:00; läuft die Story, zeigt eine dezente Pille oben mittig „Stadt-Story · noch X h Y min" (Live-Punkt), die bis zum 08:00-Reset des Corso-Tags runterzählt (konsistent mit `corsoDay()`/`storyEndsAt()`). **Lab (`story-empty-lab.tsx`):** Countdown gespiegelt, damit die Vorschau ihn zeigt. Typecheck sauber.
- **Tages-Prompts inhaltlich & strukturell überholt (16. Juli, live in der DB, unkommittiert)** — die 50 alten introspektiven Prompts sind **deaktiviert** (nicht gelöscht → Audit heil); stattdessen **40 neue, leichte, filmbare** Prompts mit **Kategorie-Hebel** `zeig`/`augenzwinkern`/`funken` (14/16/10). Neue Migrationen `0011` (Enum, `active`-Flag, Historie-Tabelle `daily_prompt`, gewichtete Rotation, View `prompt_performance`), `0012` (Seed), `0013` (`active_date` = reiner LRU-Marker, alte Unique-Regel entfernt). `get_today_prompt()` zieht jetzt **gewichtet ~40/40/20**, **nie zweimal hintereinander**, friert pro Corso-Tag ein und protokolliert in `daily_prompt` (Grundlage für Post-Raten pro Prompt). Über 60 simulierte Tage verifiziert: 0 Doppel, Gewichtung stimmt, alle 40 rotieren. Live-Funktion getestet (heutiger Prompt gesetzt & eingefroren). Alte `supabase/seed/prompts.sql` entschärft (Re-Run-Schutz). **Keine Client-/UI-Änderung nötig** — Hook ruft dieselbe Funktion. Nebenbei: Rechte-Widerspruch aus `0008` (execute für authenticated) mit repariert.
- **Aufnahme-Screen neu gestaltet (15. Juli, unkommittiert, noch NICHT deployed)** — kamera-first & minimalistisch: Auto-Start beim Betreten, full-bleed Live-Bild mit sanfter Rundung, **Prompt-Overlay im Editorial-Stil** (ruhige System-Serif `font-serif`, linksbündig wie eine Magazin-Headline, kleines Kursiv-Label „Heute" statt gesperrter Caps, weicher Scrim), runder Auslöser mit Fortschrittsring, elegante Init-/„Zugriff verweigert"-Zustände. Stadt-Story-Freigabe jetzt kompakte Pille, die **erst nach der Aufnahme** (Recorded-Zustand) über Neu/Verwenden erscheint. Nur `src/routes/record.tsx` geändert, `use-camera.ts` unberührt. Im Browser über alle Zustände verifiziert.
- **Story-Leerzustand neu gestaltet (live)** — statt schwarzem Grund jetzt ein atmosphärischer Hintergrund: cross-fadende Düsseldorf-Clips (s/w, körnig, Blue-Hour-Tint, Vignette, `blur(5px)`). In Lovable gebaut, in den **echten** `StoryEmpty` (`story.tsx`) übernommen. 6 Clips liegen in `public/empty-bg-4…9.mp4` (~35 MB).
- **Aufnahme-Echo behoben** — beim Stopp wird der Live-Stream beendet, die Vorschau spielt die echte Aufnahme (keine Rückkopplung mehr).
- **Entfolgen** in „Ich folge" — Tippen auf „folgst du heute" beendet den Follow, die Person taucht wieder in Discovery auf.
- **Dev-Buttons aus der Discovery-Topbar entfernt** (Reset simulieren / App zurücksetzen) — Simulation nur noch über das Admin-Dev-Menü.

> ⚠️ **Großer unkommittierter Feature-Batch im Working Tree** (noch NICHT committet, aber **deployed & live**): Stadt-Story-Ziehung (`story.tsx`), Admin-Dev-Menü (`dev-menu.tsx`), E-Mail-freie Einladungs-Links (`src/lib/invites/`, `server.ts`, `scripts/make-invites.mjs`), Prompt-aus-DB (`get_today_prompt`, `src/lib/prompts/`, `daily-prompt-splash.tsx`), `corso-day.ts`, Lovable-Sandbox-Routen (`story-lab.tsx`, `story-empty-lab.tsx`), Story-Leerzustand-Redesign (`StoryEmpty` in `story.tsx`) + die 6 Hintergrund-Videos `public/empty-bg-4…9.mp4` (~35 MB, nicht in Git), Migrationen `0004`–`0013` + `supabase/seed/` (Tages-Prompts überholt: `0011`–`0013`, siehe UI-Politur oben). Alle DB-Migrationen sind **live angewendet**, Frontend ist **deployed** — nur **Git-Commit steht aus**. ⚠️ Bei Commit klären: sollen die ~35 MB MP4s ins Repo oder via Git-LFS / separates Hosting?
>
> ➕ **Zusätzlich (15.–16. Juli): Aufnahme-Screen-Redesign in `src/routes/record.tsx`** — unkommittiert **und** noch **nicht deployed** (anders als der obige Batch, der live ist). Rein Layout/UX (kamera-first, Auto-Start, runder Auslöser, Stadt-Story-Pille erst im Recorded-Zustand); `use-camera.ts` unangetastet. **Prompt-Overlay (16. Juli): 4 Design-Varianten temporär durchschaltbar gebaut → Maxim wählte „Editorial"** (System-Serif `font-serif`, linksbündige Magazin-Headline, Kursiv-Label „Heute", weicher Scrim); Varianten-Switcher + die anderen 3 danach wieder entfernt, nur die gewählte Version bleibt. Im Browser über alle Zustände verifiziert (inkl. Lesbarkeit über hellem Hintergrund). Noch offen: committen + deployen (`bash scripts/deploy.sh`).
>
> ➕ **Rücklauf-Screen (15. Juli): `feedback.tsx` komplett gebaut — deployed & live, unkommittiert.** Zwei private Kennzahlen (Publikum = aktive Follower, Zuschauer = eindeutige Betrachter des letzten Moments inkl. anonymer Pool-Zuschauer) mit neutralem „seit gestern"-Delta. **Layout (16. Juli, redeployed):** dein aktueller Moment als Video-Hintergrund, die zwei Zahlen als ruhiges Overlay unten; ohne eigenen Moment ein ruhiger Zahlen-Screen (Publikum steht trotzdem). Neu: Migration `0010_post_views_feedback.sql` (**live angewendet**) mit `post_views`-Tabelle, `record_view()`/`my_feedback()`/`snapshot_reach()` (SECURITY DEFINER, RLS-privat) + Cron `reach-snapshot-daily`. Additive `record_view`-Aufrufe in `index.tsx`/`story.tsx`/`connections.tsx`, neuer Helfer `src/lib/record-view.ts`, Typen in `supabase/types.ts`, Apply-Helfer `scripts/db-apply.mjs`, Negativ-Test `scripts/security-test-feedback.mjs`. Noch offen: Git-Commit. ⚠️ **Deltas werden erst nach dem ersten nächtlichen `snapshot_reach`-Lauf sichtbar** (davor kein „gestern").
>
> 🔑 **Cloudflare-Secret — nur noch fürs Einladungs-Einlösen:** `SUPABASE_SERVICE_ROLE_KEY` als CF-Pages-Secret setzen: `npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name corso-app`. **Noch nicht gesetzt** → Einladungs-Links liefern bis dahin einen Fehler. **Der Tages-Prompt braucht das Secret NICHT (mehr)** — er läuft seit 15. Juli über Client-RPC (`supabase.rpc('get_today_prompt')`, authenticated), der service_role-Key bleibt komplett aus dem Edge raus.

### ✅ Deployment-Problem GELÖST (2. Juli)
- **Wurzel-Ursache gefunden:** `.env` setzt `NODE_ENV=development`. Beim `vite build` ließ das den JSX-Transform (oxc/plugin-react in Vite 8) die **Dev-Runtime** nutzen → überall `jsxDEV(...)`-Aufrufe, während React als Produktion gebaut wird und `jsxDEV` auf `void 0` setzt. Ergebnis beim Rendern einer Route: `TypeError: (void 0) is not a function` → Fehler-Screen.
- Die früheren Splash-/jsxDEV-Patches waren Flickwerk und deckten nur das Haupt-Bundle ab (deshalb kam man bis zum Login, aber jede echte Route crashte).
- **Fix an der Wurzel:** `scripts/deploy.sh` erzwingt jetzt `NODE_ENV=production` für den Build. Damit wird gar kein `jsxDEV` mehr emittiert — **kein Patch mehr nötig**. `.env` bleibt unangetastet (NODE_ENV=development ist für den Dev-Server korrekt).
- Zusätzlich: `deploy.sh` nutzt kein `bun` mehr (auf dieser Maschine nicht installiert) → robuste Erkennung bun→npm→lokales vite, plus Sicherheitsnetz das bei `jsxDEV` im Bundle den Deploy abbricht.
- **End-to-end verifiziert im Browser** (2. Juli): Login-Screen → Magic-Link (Redirect-Allowlist ok) → Handle-Screen → Discovery + Story + Ich-folge + Aufnahme + Rücklauf rendern alle sauber, keine Konsolen-Fehler. Test-User danach wieder gelöscht.

### Existierende Screens (Routes in `src/routes/`)
| Route | Screen | Stand |
|---|---|---|
| `index.tsx` | Discovery (Entdeckungs-Feed, vertikaler Swipe) | Echte Posts aus der DB; Follow schreibt in die DB; **kein Mock-Fallback mehr** (ehrlicher Leerzustand). **Countdown-Slide entfernt (16. Juli):** Discovery startet direkt beim ersten Moment — der 20:00-Countdown lebt jetzt auf dem Story-Screen. **Ziel = langer Scroll-Feed** (Entscheidung 15. Juli, siehe Abschnitt unten): Infinite Scroll, heute zuerst + ältere als Nachschub (interim), Endzustand nur heute. **Noch offen:** aktuell hartes `limit 20` ohne Pagination/Tages-Ordering. |
| `story.tsx` | Stadt-Story (20:00-Ritual) | **De-mockt (15. Juli):** liest die stadtweit eingefrorene Auswahl aus `city_story_slots`; serverseitige gewichtete Zufallsziehung um 20:00 via pg_cron. Kein Mock mehr. **Leerzustand neu (15. Juli):** `StoryEmpty` mit atmosphärischem Video-Hintergrund (cross-fadende s/w Düsseldorf-Clips, körnig, Blue-Hour-Tint, `blur(5px)`) statt schwarzem Grund — live. **Countdown hierher verlegt (16. Juli):** Leerzustand zeigt den großen `Std:Min:Sek`-Countdown auf die nächste 20:00; läuft die Story, zeigt eine dezente Pille oben „Stadt-Story · noch X h Y min" bis zum 08:00-Reset (`storyEndsAt()`). |
| `record.tsx` | Aufnahme (echte Live-Kamera) | Kamera live; „Verwenden"-Upload **funktional**; **UI-Flow im echten Browser end-to-end verifiziert (15. Juli): aufnehmen → hochladen → erscheint bei anderen in Discovery**. **Echo-Fix:** beim Aufnahme-Stopp wird der Live-Stream beendet (Mic zu, `srcObject` frei) → die Vorschau spielt die echte Aufnahme statt weiter das Live-Bild mit Rückkopplung. **Prompt aus der DB (15. Juli):** nicht mehr hartcodiert — Tages-Prompt kommt aus `get_today_prompt()`, subtiles Overlay oben im Kamerabild. **UI-Redesign (15. Juli, unkommittiert):** kamera-first — beim Betreten **Auto-Start** (kein „Kamera starten"-Schritt mehr), full-bleed Live-Bild mit sanfter Rundung, Prompt-Overlay oben im **Editorial-Stil** (System-Serif, linksbündige Magazin-Headline, Kursiv-Label „Heute", weicher Scrim), runder Auslöser mit Fortschrittsring (bis 15 s), Init-Spinner + freundliche „Zugriff verweigert"-Karte (iOS-Anleitung) statt schwarzer Fläche. Stadt-Story-Freigabe von Card-Balken → **kompakte Pille, erscheint erst im Recorded-Zustand** direkt über Neu/Verwenden. 🔒 `use-camera.ts` unberührt, kein Galerie-Upload, Einwilligung funktional. Alle Zustände im Browser verifiziert (Auto-Start, live, Aufnahme, recorded, Toggle an/aus, Zugriff-verweigert). |
| `connections.tsx` | „Ich folge" / verdienter Chat | „Ich folge" aus **echtem Follow-Graph**; Anstupsen + Follow-Erneuern schreiben in die DB; **Entfolgen** per Tippen auf „folgst du heute" (`unfollow()` markiert `expires_at = now()`) → Person taucht wieder in Discovery auf; verdienter Chat = Phase 3 |
| `settings.tsx` | Einstellungen (Screen 10, minimal) | **Neu gebaut & deployed (16. Juli):** bewusst schmaler Screen, erreichbar über das Zahnrad oben rechts auf Discovery (`index.tsx`, Button → `<Link to="/settings">`). Genau vier ruhige Blöcke: **(1) Benachrichtigungen** — ein `Switch` für `push_enabled` (nur Präferenz gespeichert, Push-Logik folgt); **(2) Sicherheit** — „Blockierte Personen" als sauberer Platzhalter (`useBlockedProfiles`-Stub liefert `[]`, leerer Zustand, dockt in Phase 2 an eine künftige `blocks`-Tabelle an); **(3) Rechtliches** — drei Links auf Platzhalterseiten `/impressum`, `/datenschutz`, `/agb` (gemeinsames Gerüst `src/components/legal-page.tsx`, „Inhalt folgt"); **(4) Account** — Anzeigename ändern (einziges frei editierbares Textfeld, speichert `display_name`, 1–40 Zeichen), Abmelden (`signOut()` → AuthGate zeigt Login), Konto löschen = **KEIN** Self-Service, Hinweis + Mailto `contact@subworx.io` (Pilot-Provisorium, so im Code kommentiert). Bewusst weggelassen: Profilfoto, Bio, E-Mail-Ändern, globale Sichtbarkeitskontrolle. Neue Auth-Methode `updateProfile()` in `auth-context.tsx` (schreibt + aktualisiert lokalen State). ⏳ **Migration `0014_profile_settings.sql` (display_name + push_enabled) noch NICHT angewendet** — bis dahin werfen Push-Schalter + Namensfeld eine Fehler-Toast. |
| `feedback.tsx` | Rücklauf (private Reichweite) | **Komplett gebaut & DEPLOYED (Phase 1, 15. Juli, live, unkommittiert):** zwei private Kennzahlen — **Publikum** (aktive Follower) + **Zuschauer** (eindeutige Betrachter des letzten Moments, inkl. anonymer Pool-Zuschauer) — je mit neutralem „seit gestern"-Delta (↑/↓/–, kein Rot, kein trauriges Icon). Bewusst NUR zwei Zahlen: „Follower" und „Publikum" wären identisch → keine Redundanz (Abstimmung Maxim/Dominik). **Layout:** dein aktueller Moment als Video-Hintergrund, die zwei Zahlen als ruhiges Overlay unten (Moment-als-Hintergrund, Entscheidung 16. Juli); ohne eigenen Moment ein ruhiger Zahlen-Screen (Publikum steht trotzdem). Erststate „noch kein Gestern", Zustände für nicht-eingeloggt/kein-Post. Daten aus `my_feedback()` (SECURITY DEFINER, argumentlos, RLS-privat). Ansichten anonym via `post_views` + `record_view` (Discovery/Story/Ich-folge feuern beim aktiven Clip). „seit gestern"-Basis: nächtlicher `snapshot_reach()`-Cron (`5 7 * * *` UTC). Migration `0010`, live. Negativ-Test `scripts/security-test-feedback.mjs` (Layer 1 grün). |

---

## Deployment

**URL:** `https://corso-app.pages.dev` (Cloudflare Pages — läuft ohne MacBook, extern testbar)
**Plattform:** Cloudflare Pages, Preset `cloudflare-module`, Worker-SSR mit Assets-Binding
**Deploy-Befehl (der einzige, den du brauchst):**
```bash
bash scripts/deploy.sh
```
Das Script baut mit `NODE_ENV=production`, prüft dass kein `jsxDEV` im Bundle landet, baut `deploy/` aus `dist/` zusammen und deployt via Wrangler. **Keine manuellen Patches mehr.**

**Voraussetzungen:** Wrangler eingeloggt (`npx wrangler whoami` → tools@subworx.io) und Node/npm vorhanden. `bun` ist optional (Script fällt auf npm/vite zurück).

**Wichtig zum Testen nach Deploy:** Cloudflare-Edge + Browser cachen die alte HTML kurz. Ein frischer Besucher bekommt sofort die neuen Bundle-Hashes; beim eigenen Nachtesten ggf. hart neu laden.

---

## E-Mail-Versand (Magic-Link via SendGrid)

**Stand (2. Juli): Supabase-seitig korrekt konfiguriert, Custom-SMTP über SendGrid aktiv.**
Ausgelesen per Management API (`GET /v1/projects/{ref}/config/auth`):

| Feld | Wert |
|---|---|
| Custom SMTP | aktiv |
| Host / Port | `smtp.sendgrid.net` : `587` (STARTTLS) |
| SMTP-User | `apikey` (SendGrid-Konvention) |
| SMTP-Pass | gesetzt (SendGrid-API-Key) |
| Absendername | `Corso` |
| Absender-/Admin-Mail | `dominik@subworx.io` |
| Rate-Limit | 100 Mails/Stunde (Builtin wären nur ~4/h) |
| Link-Gültigkeit | 3600 s (1 h) |

### ✅ GELÖST (15. Juli): Login-Mails landen jetzt im Posteingang (nicht mehr Spam/Junk)

Der Spam-Placement-Blocker ist behoben — Login-Mails kommen im Posteingang an. Damit können echte Pilot-User sich selbst per Magic-Link einloggen; die Admin-Login-Links als Workaround sind nicht mehr nötig (bleiben als Notfall-Option verfügbar). Der genaue Fix-Weg (Tracking aus / Link-Branding / Vorlage) wurde nicht protokolliert. Die Diagnose-Historie unten bleibt als Referenz stehen, falls das Problem wiederkehrt.

---

### 🔍 Diagnose-Historie (7. Juli, jetzt erledigt): Mails wurden gesendet UND zugestellt — landeten aber in Junk/Quarantäne (Inbox-Placement, kein Versandproblem)

**Symptom:** „Login-Link-Mail kommt nicht an." User ab 2. Juli bleiben auf `confirmed: false`.

**Verlauf der Diagnose (wichtig, weil eine Zwischenthese falsch war):**
1. `POST /auth/v1/otp` (App-Pfad) → **HTTP 200**, kein 500/429 → Supabase übergibt sauber an SendGrid. Admin-`generate_link` liefert gültige Login-Links → Auth-Pipeline intakt.
2. **Zwischenthese „Domain nicht authentifiziert" war FALSCH.** Erster `dig` suchte `s1/s2._domainkey` — der Account liegt aber in der **SendGrid-EU-Region**, Selektoren heißen `eus1/eus2._domainkey`. Die lösen sauber auf.
3. Per SendGrid-API (v3, Read-Key) verifiziert:
   - `subworx.io` (id 26670791, return-path `em9318`) → **valid=True, DKIM1/DKIM2/SPF alle valid** → DKIM `d=subworx.io`, **DMARC-aligned**. Domain-Auth ist korrekt.
   - `mail.subworx.io` (id 30116392) → **valid=False** (halber, toter Auth-Versuch — aufräumen/löschen).
   - Alle Suppression-Listen (bounces/blocks/spam/invalid) für alle Empfänger **leer**.
   - **Email Activity Feed:** Magic-Link-Mails (Subjects „Your sign-in link" / „Confirm your email address" = Supabase-Templates) an `dominik@subworx.io` und `tools@subworx.io` → Status **`delivered`**. Empfänger-Server (M365) hat mit 250 OK angenommen.

**Ursache:** Kein Versandfehler. Die Mail wird zugestellt, aber **nicht in den Posteingang, sondern in Junk/Quarantäne** einsortiert. `delivered` = angenommen, ≠ Posteingang. Klassiker bei **Microsoft 365**, wenn „von der eigenen Domain" (`dominik@subworx.io`) über einen externen Relay (SendGrid) an dieselbe M365-Domain gesendet wird → M365-Spoof-Intelligence quarantänisiert, obwohl DMARC passt.

**Gmail-Test (7. Juli, `domanczok+2378@gmail.com`):** Status `delivered` → **im Spam gelandet.** Also NICHT nur ein M365-Eigendomain-Effekt — die echten Pilot-User (Gmail/GMX) sind betroffen.

**Gmail-Hauptursache identifiziert:**
- **Kein Link-Branding** (`GET /v3/whitelabel/links` = leer) + **Click-Tracking aktiv** → SendGrid schreibt den Login-Link auf einen **`*.sendgrid.net`-Redirect** um. Login-Link über fremde Tracking-Domain = starkes Gmail-Spam-Signal (Phishing-Muster).
- Dazu die **englische Supabase-Default-Vorlage** (nackter Link, wenig Text).
- Auth (DKIM/SPF/DMARC) + Reputation (100/100) sind tadellos → nicht die Ursache.

**Fix-Optionen (2 Wege zum selben Ziel — den `sendgrid.net`-Redirect loswerden):**
- **A) Tracking global aus** (kein DNS, sofort): Click-+Open-Tracking kontoweit abschalten → Login-Link bleibt die rohe `supabase.co/...`-URL. Sauberster Weg für Auth-Mails. Kosten: estateos/adkl-msi verlieren Klick-/Öffnungs-Statistik (senden weiter normal, kein Break).
- **B) Link-Branding** `link.subworx.io` (braucht IONOS-DNS): behält estateos-Statistik, ersetzt nur die Redirect-Domain. Verifiziert (SendGrid-Doku + GitHub-Issue #5653): Root-Branding auf `subworx.io` greift NUR für exakte `@subworx.io`-Absender (Corso), NICHT für Subdomain `@estateos.subworx.io` → estateos + adkl-msi bleiben unberührt.
- Hinweis: „Tracking nur für Corso aus" ist NICHT möglich (Tracking ist kontoweit; Supabase-SMTP kann keine per-Mail-Ausnahme setzen; Subuser = kein Zugriff/kalte IP; eigener Account = Overkill).

**Ergänzend (unabhängig vom Link-Fix):**
- **Deutsche Corso-Vorlage** → `supabase/templates/auth_email_de.html`, in Supabase Auth-Templates (Magic Link + Confirm signup) einfügen. Wirkt voll erst NACH dem Link-Fix (sonst wird auch der sichtbare Link umgeschrieben).
- **M365 (nur eigene @subworx.io-Tests):** Safe-Sender / Tenant-Allow — betrifft echte User nicht.
- **Aufräumen:** tote Whitelabel `mail.subworx.io` (valid=False) löschen.

**AKTUELLER STAND (7. Juli, bewusst PAUSIERT — kein DNS-Appetit):**
- Link-Branding-Eintrag in SendGrid **bereits angelegt** (id `5500551`, `subworx.io`/subdomain `link`, `default=false`, **`valid=false` = inert**). Ändert nichts, bis die 2 CNAMEs bei IONOS gesetzt + validiert werden. Jederzeit löschbar.
- Ausstehende CNAMEs (nur für Weg B): `link.subworx.io → sendgrid.net` und `39222136.subworx.io → sendgrid.net`, danach `POST /whitelabel/links/5500551/validate`.
- Tracking unverändert (an). Deutsche Vorlage geschrieben, aber **noch nicht** in Supabase eingespielt.
- **Nächster Schritt, wenn wieder Bock:** Weg A (Tracking aus, kein DNS) ODER Weg B (CNAMEs) → dann Vorlage einspielen → Gmail-Test wiederholen.

**Sofort-Entblocker (jederzeit, ohne Mail):** Login-Links per Admin-API (`POST /auth/v1/admin/generate_link`, service_role) generieren und `action_link` direkt an User geben (z. B. WhatsApp/Signal) — umgeht die Mail komplett. Für den Freundes-Pilot völlig ausreichend.

**Bestätigung (optional):** SendGrid → Activity Feed zeigt pro Mail „Delivered / Dropped / Blocked / Deferred" — die Grundwahrheit, was Microsoft mit der Mail gemacht hat.

---

## Discovery-Feed — Umfang & Verhalten (Entscheidung 15. Juli)

**Vision:** Discovery ist ein **langer Scroll-Feed**, der ein ausgedehntes Scrollverhalten etabliert — nicht ein knappes Kartendeck. Umfang = alle Momente des Tages aus deiner Area.

- **Reihenfolge jetzt (Interim, dünner Pilot):** **heute zuerst, dann ältere Momente als Nachschub.** Bewusst KEIN harter Tagesfilter, weil „nur heute" bei kleiner Nutzerbasis den Feed leer wirken lässt.
- **Endzustand (fertige App):** **nur heutiger Corso-Tag** (`prompt_date = corso_day(now())`).
- **Area:** = **ganze Stadt Düsseldorf** (Pilot) → alle User in Düsseldorf, Area-Filter vorerst No-Op. Feinere Area (Stadtteil/Radius) bewusst NICHT jetzt.
- **Laden:** **Infinite Scroll** — erst ~20, beim Erreichen des Endes die nächsten 20 nachladen (`range()`/`useInfiniteQuery`), nicht alles buffern.
- **Bestehende Regeln bleiben:** eigene Posts via `author_id ≠ auth.uid()` aus; gefolgte Personen verlassen den Feed.

**Aktueller Code-Stand (`src/routes/index.tsx`):** hartes `limit 20, order by created_at desc`, KEIN `prompt_date`-Filter, KEINE Pagination. **Noch nicht gebaut:** Infinite Scroll + „heute zuerst"-Ordering. Der Endzustand-Filter (`= heute`) kommt bewusst erst später. Nicht ungefragt auf „nur heute" eingrenzen.

---

## Täglicher Prompt aus der DB (15. Juli)

Der Tages-Prompt (PRD §4.2) kommt jetzt aus der DB statt hartcodiert.

- **Migration `0008_prompts_active_date.sql` (live angewendet):** bestehende `prompts`-Tabelle per ALTER umgebaut (`prompt_date` → `active_date`, nullable). RLS unverändert korrekt (read-only für authenticated, Schreiben nur service_role).
- **`get_today_prompt()`** (SECURITY DEFINER, atomar mit Advisory-Lock): gibt den Prompt für `corso_day()` zurück; ist noch keiner gesetzt, zieht sie zufällig einen Kandidaten (`active_date IS NULL` oder älter als 90 Tage), setzt dessen `active_date` auf heute. Ausführbar für `authenticated` + `service_role` (anon gesperrt). Schreiben in `prompts` bleibt trotzdem nur der Funktion vorbehalten (SECURITY DEFINER), die RLS „write nur service_role" ist gewahrt.
- **Seed:** 50 emotionale Prompts (`supabase/seed/prompts.sql`, idempotent) — live eingespielt, 0 datiert.
- **Frontend (Client-RPC, KEIN Server-Secret):** `useTodayPrompt` ruft `get_today_prompt()` direkt per `supabase.rpc` mit dem normalen anon-Key + User-JWT auf — **kein service_role, kein Cloudflare-Secret nötig** (bewusst gegen die ursprüngliche Server-Action getauscht, um den Key aus dem Edge zu halten). Geteilter Query-Key → ein Call für Splash + Kamera-Overlay (`record.tsx`).
- **`DailyPromptSplash`** (Vollbild, 3 s auto-aus, localStorage `corso_last_prompt_seen` = Corso-Tag, SSR-sicher): **Hintergrund = exakt der Story-Empty-Look** (`CityBackdrop`: geblurrte s/w Düsseldorf-Clips `empty-bg-4…9`, harte Cuts, Vignette/Tint/Grain), einen Tick dunkler + dezenter Glas-Container um den Prompt. Clips ~35 MB (dieselben wie der Story-Screen).
- **Dev-Vorschau:** Button „Prompt-Splash zeigen" im Admin-Dev-Menü (`dev-menu.tsx`) blendet den Splash on-demand ein (reine Vorschau, kein localStorage/DB-Write).
- **Freeze-Fix:** vaul-Drawer im Dev-Menü auf `modal={false}` + `pointer-events`-Sicherheitsnetz → kein Einfrieren mehr nach dem Splash.
- **Status: deployed & live** auf `corso-app.pages.dev`. Der Prompt braucht **kein** Cloudflare-Secret (das Einladungs-Einlösen des anderen Agenten schon — siehe Warnung oben, das ist ein separates Feature).

---

## Follower-Zahl-Privatsphäre (RLS-Audit, 15. Juli)

**Kern-Leitplanke:** 🔒 die private Publikums-/Follower-Zahl ist serverseitig nur für den Nutzer selbst lesbar. Audit-Ergebnis: **Architektur ist korrekt** (keine Neubau nötig, Follows waren schon DB-basiert, kein localStorage mehr).

- **Schutz-Mechanik:** `follows`-SELECT-Policy `follower_id = auth.uid()` (niemand sieht, wer IHM folgt) + `my_reach()` (SECURITY DEFINER, zählt nur `auth.uid()`, kein Parameter) + `reach_snapshots` `read_own`. Über keinen Pfad (direkter Select, `count:exact`, Join, RPC, roher REST) kommt B an A's Zahl.
- **Live gegen anon geprüft (kein Secret, nur anon-Key):** `follows`, `reach_snapshots`, `profiles`, `nudges`, `city_story_slots`, `connections` → alle `count=0` für Unauthentifizierte. RLS ist überall aktiv. Test: `scripts/security-test-follows.mjs` (Layer 1 grün).
- **Eine Looseness gefunden + gehärtet (live, 15. Juli):** `my_reach()` war für anon ausführbar (lieferte harmlos `0`). Migration `0004_reach_grant_hardening.sql` **angewendet** (via Management-API) → revoke public/anon, nur authenticated, + expliziter `auth.uid() is null → 0`-Guard. Verifiziert: anon bekommt jetzt `permission denied for function my_reach`. `proacl` enthält kein `anon` mehr.
- **Bewusst NICHT geändert:** `follows_update_own` — das Zurücksetzen von `expires_at` ist der legitime `renew()`-Pfad; eine Policy dagegen würde Erneuern brechen und ist keine Privatsphäre-Frage.
- ✅ **Zwei-User-Beweis erbracht (residue-frei, in-DB via simulierte JWT-Claims, alles zurückgerollt):** A hat 1 aktiven Follower → Angreifer B zählt via `followee_id=A` **0**, B's `my_reach`=B's eigene (0), A's `my_reach`=**1**, A's direkte Followerliste **0**. B bekommt A's Zahl über keinen Pfad. Reproduzierbar: `scripts/security-test-follows.mjs` (Layer 1 anon) + In-DB-Simulation.

---

## Backend-Bausteine (Phase 0)

1. ✅ **Backend-Stack entschieden: Supabase** (Auth + Postgres + Storage + pg_cron).
2. ✅ **Datenmodell** (`0001_init.sql`): profiles, prompts, posts, follows, nudges, city_story_slots, reach_snapshots inkl. RLS + `corso_day()` + `my_reach()`.
3. ✅ **Supabase-Projekt CORSO** (ref `uuhrylkvwosflyypbdbj`) live, URL + anon-Key in `.env`. ⚠️ **Zu rotierende Secrets** (wurden im Chat geteilt): service_role-Key (Settings → API → Roll) **und** zwei Personal Access Tokens `sbp_9a4a…` / `sbp_2ab7…` (Account → Access Tokens → Revoke). PAT = Vollzugriff auf den ganzen Account.
4. ✅ **`@supabase/supabase-js` installiert** + Client: `src/lib/supabase/client.ts` (SSR-sicher).
5. ✅ **Supabase eingerichtet**: Migration eingespielt, Bucket `moments`, Auth aktiviert, Redirect-URL `https://corso-app.pages.dev` in Supabase.
6. ✅ **Auth (Magic-Link):** `src/lib/auth-context.tsx` + `src/components/auth-gate.tsx`, eingehängt in `__root.tsx`.
7. ✅ **Follow-Verfall (08:00-Reset):** `supabase/migrations/0003_follows_expiry.sql` — `expires_at`-Spalte, Zwei-Reset-Regel, pg_cron (`expire-follows-daily` täglich 07:00 UTC = 09:00 Berlin), `dev_expire_my_follows()` als Test-Tool. Die Dev-Buttons (Alarm = Reset simulieren, Restart = App zurücksetzen) sind aus der Discovery-Topbar **entfernt** — manuelle Simulation läuft über das Admin-Dev-Menü (`dev_menu_*` RPC) bzw. direkt per SQL.
8. ✅ **Storage-RLS-Policies** für `moments` (Upload/Read/Delete own) → `0002_storage.sql` **live angewendet** — 7. Juli end-to-end mit Wegwerf-User verifiziert (Upload in eigenen Ordner, Read authenticated).
9. ✅ **Video-Upload** in Bucket `moments` (`src/lib/supabase/upload.ts`): Upload → `posts`-Insert → signierte Read-URL laufen unter RLS durch. **UI-Flow Kamera→MediaRecorder→Upload am 15. Juli im echten Browser end-to-end verifiziert — aufgenommener Clip erscheint bei anderen Usern in Discovery.**
10. ✅ **Follow-Loop de-mockt** (7. Juli): `follow-context.tsx` lädt aktive Follows (`expires_at is null`) + Handles + heutige Anstupser aus der DB statt aus localStorage-Seeds; `follow()`/`renew()`/`nudge()` schreiben in die DB (DB-Write zentralisiert, aus `FollowButton` entfernt). Fake-Seeds **und** Fake-Discovery-Fallback (`TILES`) entfernt → Discovery + „Ich folge" zeigen nur echte Daten, sonst ehrlicher Leerzustand. Zwei-User-Follow-Loop (Follow-Write, Graph-Read, Nudge-Write) unter RLS verifiziert. `connections.tsx`: „Moment heute?" hängt jetzt am echten heutigen Video → Anstups-/Leerzustand wieder erreichbar.
11. ✅ **Deploy-Script automatisiert** (`scripts/deploy.sh`) — ein Befehl, Produktions-Build ohne jsxDEV-Crash, robuste Build-Runner-Erkennung, Sicherheitsnetz. Root-Cause (`NODE_ENV=development`) an der Wurzel behoben.

---

## Supabase / Cloudflare Redirect-URLs

- Supabase Site-URL: `https://corso-app.pages.dev`
- Redirect-Allowlist (verifiziert 2. Juli): `https://corso-app.pages.dev/**`, `https://*.corso-app.pages.dev/**`, `https://*.ngrok-free.app/**`
- Für iPhone-Tests lokal: ngrok-URL in `.env` als `VITE_APP_URL` — Allowlist deckt `*.ngrok-free.app` bereits ab

---

## Stadt-Story-Ziehung (Phase 1, 15. Juli) — de-mockt & live

Die 20:00-Stadt-Story ist von 8 Mock-Standbildern auf eine **echte, serverseitige, gewichtete Zufallsziehung** umgestellt. Migration `0005_city_story_draw.sql` (**live angewendet** per Management API).

- **Kandidaten (serverseitig gefiltert):** Posts von heute (`prompt_date = corso_day()`) **mit** `city_story_consent = true`, Autor in der Zielstadt. 🔒 Consent wird in der SQL-Funktion erzwungen, nicht im Client.
- **Gewicht je Clip:** `w = 1 + ln(1 + aktive_follower)`. Neuling (0 Follower) → `w = 1.0` (reale Grundchance); 50 Follower → `w ≈ 4.9`. Log = abnehmender Grenznutzen, keine Rangliste. Ziehung ohne Zurücklegen (Efraimidis-Spirakis: `random()^(1/w)`, 8 größte gewinnen). 🔒 Follower-Zahl wird **inline** gezählt, verlässt die Funktion nie → kein Leak.
- **Verifiziert (Monte-Carlo 2000×):** Neuling mit 0 Followern wird an ~36 % der Tage gezogen; „Whale" mit 800 Followern an 95 % — trotz 800× Follower nur ~2,6× die Chance. Echte Pipeline-Ziehung: 2 von 3 Nuller-Neulingen landeten in der Auswahl.
- **Eingefroren & stadtweit identisch:** `draw_city_story(city, force)` schreibt 8 Slots nach `city_story_slots` (jetzt mit `city`-Spalte). `force=false` ist idempotent (deckt „Cron doppelt gelaufen" ab). Alle Clients lesen dieselben Slots.
- **Zeit:** pg_cron `city-story-draw-summer` (18:00 UTC) + `city-story-draw-winter` (19:00 UTC); `run_city_story_draw()` prüft selbst `= 20 Uhr Berlin` und no-opt sonst → DST-sicher exakt 20:00.
- **Frontend:** `story.tsx` liest `city_story_slots` für heutigen Corso-Tag + Stadt, signierte Video-URLs, gleiche UX wie Discovery. 🔒 **Keine Follower-/Reaktions-Zahlen sichtbar** — Query selektiert keine Zahlen, nur Handle + Ort. Leerzustand statt Fake, wenn (noch) keine Story.
- **Dev-Werkzeuge (nur Test):** manueller Trigger `select draw_city_story('Düsseldorf', true);`; Seed `select dev_seed_city_story('{0,0,1,3,8,20,60,150}');`; Aufräumen `select dev_clear_city_story_test();`. Testdaten nach Verifikation wieder entfernt (DB sauber).
- **In-App-Dev-Menü (`0006_dev_admin_controls.sql` + `src/components/dev-menu.tsx`):** Ribbon-Button (Terminal-Icon, amber) **nur für `dominik@subworx.io`** sichtbar; Drawer mit 5 Aktionen (Story ziehen / Story zurücksetzen / meine Follows verfallen / Fake-Clips seeden / Fake-Daten löschen), jede mit Bestätigungs-Schritt. Aktionen laufen über Admin-gegatete RPC-Wrapper `dev_menu_*` (`is_dev_admin()` prüft die E-Mail serverseitig).
- **🔒 Security-Fix (wichtig):** Supabase-Default-Grants hatten die Roh-Funktionen aus 0005 (`draw_city_story`, `dev_seed_city_story`, `dev_clear_city_story_test`, `run_city_story_draw`, `expire_follows`) faktisch für **jeden** `authenticated`/`anon` aufrufbar gemacht (mein `revoke from public` griff nicht gegen die expliziten Rollen-Grants). 0006 sperrt `execute` für anon/authenticated zu — nur postgres/service_role (intern/Cron) + die Admin-Wrapper rufen sie noch auf. Verifiziert via `has_function_privilege`.
- **Zukunftssicher:** Ziehung läuft pro Stadt (`profiles.city`); real nur Düsseldorf aktiv, keine Migration nötig für weitere Städte.
- ✅ **Deployed & live**; Ziehung + Gewichtung per Seed/Force-Draw verifiziert. ⏳ Offen bleibt nur ein echter 20:00-Cron-Lauf mit echten einwilligenden Posts.

---

## Lovable-Sandbox für Story-Design (15. Juli)

Zum gefahrlosen visuellen Iterieren (z. B. in Lovable) gibt es **eigenständige Vorschau-Routen** mit Mock-Daten, ohne Supabase/Auth — der echte `story.tsx` bleibt unangetastet:
- **`src/routes/story-lab.tsx`** (`/story-lab`) — Story-Karten-Ansicht als Sandbox.
- **`src/routes/story-empty-lab.tsx`** (`/story-empty-lab`) — nur der Leerzustand (Hintergrund-Clips aus `public/empty-bg-*.mp4`). **Look fertig iteriert & zurückportiert (15. Juli):** der atmosphärische Video-Hintergrund (cross-fadende s/w Clips, Grain, Blue-Hour-Tint, `blur(5px)`) ist jetzt der echte `StoryEmpty` in `story.tsx` — live. Die Lab-Route bleibt zum Weiter-Schrauben bestehen (hält denselben Look, `blur` in beiden Dateien synchron). **20:00-Countdown (16. Juli) ist in beiden Dateien gespiegelt** — die Vorschau zeigt ihn 1:1 wie der echte `StoryEmpty`. Wer hier am Look schraubt, muss Änderungen von Hand nach `story.tsx` zurücktragen.
- Branch **`story-experiments`** (auf GitHub) trägt `story-lab`; Lovable arbeitet darauf. Guter Look → wird manuell in den echten `story.tsx`/`StoryEmpty` zurückportiert.

---

## Einladungs-Links (E-Mail-frei) — ⚠️ PILOT-PROVISORIUM (15. Juli)

**Zweck:** Für den gratis Freundes-Pilot umgehen wir E-Mail komplett (Magic-Links landen im Spam). Maxim verschickt pro Freund einen persönlichen Link per WhatsApp → Klick = eingeloggt, ohne Code, ohne Mail.

**⚠️ Bewusste Übergangslösung mit Verfallsdatum — KEINE dauerhafte Auth-Architektur.** Der spätere zahlende Fremden-Pilot bekommt echte Self-Service-Registrierung. Nicht als Fundament weiterbauen. So markiert in: `0009_invites.sql`, `src/lib/invites/server.ts`, `src/server.ts`, `scripts/make-invites.mjs`.

**Bausteine:**
- **`invites`-Tabelle** (`0009_invites.sql`, live): `token` (kryptografisch zufällig), `friend_name`, `friend_email`, `expires_at` (7 Tage), `redeemed_at`/`redeemed_by`. 🔒 RLS an, KEINE Policy + Grants entzogen → nur `service_role` (serverseitig) kommt ran; kein Client-Zugriff, Tokens nicht auflistbar.
- **Erzeugen (lokal):** `scripts/make-invites.mjs` liest `scripts/friends.txt` (`Name, email` pro Zeile, gitignored) + service_role aus lokaler `.env` → druckt fertige Links. Läuft nur auf Maxims Rechner.
- **Einlösen (serverseitig, CF-Worker):** `src/server.ts` fängt `/invite/<token>` ab → `src/lib/invites/server.ts`: prüft/beansprucht Token atomar, `admin.generateLink({type:'magiclink'})` (legt User an), leitet zum Supabase-Verify → Session in der App. 🔒 Einmal-Verwendung (`redeemed_at` + Supabase invalidiert den Token) + 7-Tage-Ablauf. service_role bleibt im Worker; nach außen nur der einmalige action_link.
- **Fehler-UX:** ungültig/abgelaufen/benutzt → Redirect auf `/?invite_error=…` → klare Meldung im LoginScreen (`auth-gate.tsx`).
- **E-Mail-Login bleibt** als Rückfall (nicht entfernt).

**Stand (deployed & getestet, 15. Juli):** Route ist live; alles außer dem finalen Erfolgs-Login ist verifiziert:
- ✅ DB-Sperre: anon bekommt `permission denied for table invites`.
- ✅ Live-Route greift: `/invite/<fake>` → 302 auf `/?invite_error=…`.
- ✅ Einlöse-Logik in SQL: gültig → einlösbar, zweiter Versuch/abgelaufen/schon-benutzt → 0 (Einmal-Verwendung + 7-Tage-Ablauf bewiesen).
- ✅ Erzeugungs-Skript end-to-end (32-Zeichen-Zufallstoken, DB-Zeile korrekt).
- ✅ Kein Key-Leak im Client-Bundle; Client-Fehlermeldungen ausgeliefert.

**⏳ Einziger offener Punkt:** service_role-Key als CF-Pages-Secret setzen (siehe 🔑-Hinweis oben). Das ist das **einzige** Feature, das dieses Secret braucht (der Tages-Prompt läuft inzwischen ohne). Ohne den Key schlägt das Einlösen mit `invite_error=error` fehl (Erzeugen der Links geht ohne). Danach: echter 2-Geräte-Test (Freund drin? zweiter Klick blockiert?).

---

## Einstellungen-Screen (Screen 10, minimal) — 16. Juli

Realisiert PRD-Screen 10 („Settings / Safety") bewusst **so schmal wie möglich** — kein Feature-Creep, in zwei Sekunden abscrollbar.

- **Route:** `src/routes/settings.tsx` (`/settings`), erreichbar über das bisher tote Zahnrad oben rechts auf Discovery (`index.tsx`: Button → `<Link to="/settings">`).
- **Vier Blöcke:** Benachrichtigungen (ein `push_enabled`-`Switch`, nur Präferenz), Sicherheit (Blockierte-Personen-**Platzhalter**, andockbar an künftige `blocks`-Tabelle in Phase 2), Rechtliches (drei Links → Platzhalterseiten `/impressum`, `/datenschutz`, `/agb`, gemeinsames Gerüst `src/components/legal-page.tsx`), Account (Anzeigename ändern, Abmelden, manuelle Kontolöschung per Mailto `contact@subworx.io`).
- **Schema:** Migration `0014_profile_settings.sql` fügt `profiles.display_name` (optional, 1–40 Zeichen, CHECK) + `profiles.push_enabled` (bool, default false) hinzu. **Keine neue RLS-Policy nötig** — `profiles_update_self` (`id = auth.uid()`) deckt beide Spalten. ⏳ **Noch NICHT angewendet** (Management-Token lag nicht vor) — Befehl: `SBP=<token> node scripts/db-apply.mjs supabase/migrations/0014_profile_settings.sql`. Bis dahin werfen Push-Schalter + Namensfeld eine Fehler-Toast; der Rest des Screens läuft.
- **Auth:** neue Methode `updateProfile(fields)` in `auth-context.tsx` (schreibt `display_name`/`push_enabled` und aktualisiert den lokalen `profile`-State → überlebt Reload). Typen in `supabase/types.ts` erweitert.
- **🔒 Bewusst weggelassen** (Leitplanken): kein Profilfoto/Bio, kein E-Mail-Ändern, keine globale „nur Beobachten"-Sichtbarkeitskontrolle (eigenes Produkt-Feature für später), keine Self-Service-Kontolöschung, keine sichtbaren Zahlen. **Kontolöschung ist Pilot-Provisorium (manuell auf Zuruf), so im Code kommentiert.**
- **Stand:** gebaut, Typecheck + Build grün, **deployed & live**. Offen nur die Migration `0014`.

---

## Bekannte offene Entscheidungen, die jetzt relevant sind

- **Auth-Methode:** Für den Freundes-Pilot ist der **Hauptweg jetzt der E-Mail-freie Einladungs-Link** (WhatsApp, siehe Invite-Sektion) — umgeht das Spam-Risiko komplett. Der **Magic-Link (E-Mail) bleibt als Rückfall** aktiv (landet seit 15. Juli im Posteingang). Beides bewusst nur Pilot-Provisorium; der zahlende Fremden-Pilot bekommt echte Self-Service-Registrierung.
- ~~Stadt-Story-Größe/Frequenz bei kleinem Pilot (PRD #6)~~ → **ENTSCHIEDEN (15. Juli):** Story läuft immer mit so vielen einwilligenden Clips wie da sind (max. 8, kein Mindest-Schwellwert); kein Fake-Auffüllen. Moderation im Freundes-Pilot bewusst ohne Sperr-Modell.
- Verbindungs-Trigger bei verfallenden Follows (PRD #8) → blockt erst Phase 3.

---

*Diese Datei aktuell halten — sie ist der Einstiegspunkt für jeden neuen Kontext.*
