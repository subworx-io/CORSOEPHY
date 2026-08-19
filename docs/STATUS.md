# Corso — Status

**Stand: 19. August 2026.**
**Zweck:** Lebender Schnappschuss. Wer neu in das Projekt einsteigt (Mensch oder Agent), liest das hier zuerst und weiß, wo es steht und was der nächste konkrete Schritt ist. Diese Datei bei jedem nennenswerten Fortschritt aktualisieren.

> Reihenfolge zum Reinkommen: `CLAUDE.md` → `docs/PRD.md` (was & warum) → `docs/ROADMAP.md` (was als nächstes) → **diese Datei** (wo genau stehen wir).

---

## Die Kurzfassung

**Phase 0 (Backend-Fundament) ist durch. Phase 1 (Konsum-Loop end-to-end echt) ist zu ~60 % gebaut.**

Die App läuft live auf `https://corso-app.pages.dev`, das Git-Repo ist sauber (alles committet, letzter Commit `7baf6e7` vom 12. August), und **alle drei Server-Jobs laufen nachweislich mit echten Daten** (Beleg unten). Der Kern-Loop — posten → in Discovery erscheinen → folgen → in den Stadt Corso gezogen werden → private Zahl im Rücklauf — funktioniert vollständig ohne Mock.

**Am Abend des 19. August umgestellt:** Der feste Tagesrhythmus ist weg. Verfall läuft jetzt **pro Datensatz 24 h ab Entstehung**, der Zyklus-Wechsel (Prompt + Stadt-Corso-Ziehung) liegt auf **21:00** statt 08:00/20:00. Details unten unter „Rollender 24h-Verfall". Discovery hat dabei ihr Infinite Scroll bekommen.

**Was Phase 1 noch fehlt:** Push-Notifications.
**Was den Pilot-Start blockiert:** zwei Config-Schritte von je unter 5 Minuten (siehe „Offene Punkte").

---

## Verifizierter Live-Stand (19. August 2026 geprüft)

Alles hier wurde an diesem Tag **gegen die echte DB und die echte Deployment-Umgebung** geprüft, nicht aus älteren Notizen übernommen.

### ✅ Cron-Fahrplan (Stand 19. August abends, nach `0015`)

| Job | Schedule (UTC) | Bedeutung |
|---|---|---|
| `city-story-draw-summer` / `-winter` | `0 19` / `0 20` | Stadt-Corso-Ziehung um **21:00 Berlin**. Beide Slots feuern täglich, `run_city_story_draw()` prüft selbst die Berliner Stunde → DST-sicher. |
| `reach-snapshot-summer` / `-winter` | `5 19` / `5 20` | Basislinie für die „seit gestern"-Deltas, jetzt am **Zyklus-Start (21:05)** statt morgens. Gleicher Stunden-Guard. |
| ~~`expire-follows-daily`~~ | — | **Ersatzlos entfallen.** Verfall wird nicht mehr markiert, sondern in jeder Query über `expires_at > now()` gerechnet. |

Historischer Beleg (vor der Umstellung): echte Ziehungen am 1., 2. und 13. August, jeweils exakt 18:00 UTC = 20:00 Berlin, aus echten einwilligenden Momenten. Der Mechanismus ist also mit echtem Content bewiesen, nur die Uhrzeit hat sich verschoben.

Nebenbeleg für die Korrektheit der Ziehung: Am 11. und 12. August gab es einwilligende Momente, aber **keine** Slots im Stadt Corso — beide Momente wurden erst *nach* der damaligen Ziehungszeit hochgeladen, waren also gar keine Kandidaten. Genau das erwartete Verhalten. *(Seit `0015` kann das so nicht mehr passieren: Kandidat ist alles, was zur Ziehung noch lebt.)*

### 📊 Datenbestand

| Tabelle | Zeilen | Anmerkung |
|---|---|---|
| `profiles` | 7 | Test-Accounts, noch keine echten Pilot-User |
| `posts` | 27 | letzter vom **19. August** |
| `follows` | 11 | |
| `post_views` | 53 | |
| `city_story_slots` | 12 | aus den drei echten August-Ziehungen |
| `invites` | **0** | **→ es wurde noch kein einziger Einladungs-Link erzeugt: der Freundes-Pilot hat nicht begonnen** |

**Nach der 24h-Umstellung (live gemessen):** von 29 Momenten sind **2 lebend**, 27 abgelaufen; von 11 Follows ist **1 aktiv**. Genau das ist die neue Regel — die Discovery zeigt jetzt 2 statt 29 Momente. Das ist kein Fehler, sondern die Dichte des Test-Bestands.

**Nutzungsmuster:** Momente am 11., 12., 13. und dann wieder am 19. August — eine Lücke von sechs Tagen. Die App wird derzeit sporadisch von den Entwicklern getestet, nicht täglich genutzt. Das ist erwartbar, solange kein Pilot läuft, aber es heißt auch: **es gibt bisher keinerlei Signal zu den Kill-Metriken.**

### Code-Stand geprüft

- **Discovery** (`src/routes/index.tsx`): `useInfiniteQuery` mit `range()`-Seiten à 20 und Filter `expires_at > now()`, neueste zuerst. Infinite Scroll ist seit 19. August **gebaut**; nachgeladen wird 3 Kacheln vor dem Ende.
- **Push:** keine Service-Worker- oder `PushManager`-Referenz im Code, nur `public/manifest.json`. Push ist **nicht** gebaut.
- **Hintergrund-Videos** `public/empty-bg-4…9.mp4` sind in Git versioniert (Entscheidung 16. Juli: plain git statt LFS — für den Pilot ausreichend, frische Clones funktionieren ohne Zusatzschritt).
- **Der alte Feature-Batch ist versioniert.** Frühere STATUS-Versionen warnten vor einem großen unkommittierten Batch im Working Tree — der wurde mit `ced0823` committet, die Warnung ist erledigt und wurde entfernt. Was aktuell unkommittiert ist, steht im WIP-Abschnitt unten und ist neu.

---

## 🔧 WIP im Working Tree (19. August, unkommittiert)

**Prompt am Moment auf allen Feed-Screens — gebaut (19. August).** Das im Rücklauf bereits gebaute „zu welchem Prompt entstand dieser Moment" ist jetzt auf Discovery, Stadt Corso und „Ich folge" verallgemeinert:

- **Neu:** `src/components/moment-prompt.tsx` (gemeinsame Darstellung) und `src/lib/prompts/prompt-history.ts` — `fetchPromptsByDate()` holt die Prompt-Texte für **mehrere Corso-Tage in einer Abfrage** (statt ein Request pro Kachel; nötig, weil die Feeds interimsweise mehrtägig sind) plus `promptDayLabel()` für „Heute" / „Gestern" / „Di, 12. Aug".
- **Geändert:** `index.tsx`, `story.tsx`, `connections.tsx` laden `posts.prompt_date` mit, lösen die Texte per `fetchPromptsByDate()` auf und binden `<MomentPrompt>` ein; `feedback.tsx` nutzt jetzt den geteilten `promptDayLabel()` statt einer lokalen Kopie.
- **Darstellung (Entscheidung 19. August, Maxim/Dominik):** Editorial-Overlay **oben auf der Kachel** — Optik 1:1 vom Aufnahme-Screen (System-Serif, linksbündige Magazin-Headline, weicher Scrim statt Box), **mit Tages-Label** darüber. Linker Einzug (`pl-[4.5rem]`) hält die Spalte des Ton-Buttons frei, `pointer-events-none` lässt ihn klickbar. Unten bleibt frei für Handle + Folgen-Button. Damit sieht „Prompt" überall gleich aus: Aufnahme → Discovery → Ich folge → Stadt Corso → Rücklauf.
- **Warum mit Tages-Label:** Discovery zeigt interimsweise auch ältere Momente als Nachschub — ohne den Tag wechselte der Prompt beim Scrollen ohne sichtbaren Grund.
- Hält sich an die bestehende Regel: Auflösung ausschließlich über `daily_prompt`, **kein Rückfall auf `prompts.active_date`** — ohne Historie wird nichts angezeigt statt etwas Falsches. Kein DB-Change nötig (`daily_prompt` ist per RLS für alle Angemeldeten lesbar).

✅ Typecheck + Production-Build grün, neue Dateien lint-sauber.
⚠️ **Nicht committet, nicht deployed, nicht im Browser gesehen** — die Optik auf einem echten Gerät (lange Prompts, Zusammenspiel mit dem Badge des Stadt Corso oben) steht noch aus.

---

## 🚧 Offene Punkte — nach Dringlichkeit

### 1. ~~Migration `0014` nicht angewendet~~ ✅ erledigt (19. Aug abends)

`0014_profile_settings.sql` **und** `0015_rolling_24h_expiry.sql` sind angewendet. `profiles.display_name` / `push_enabled` existieren, der Einstellungen-Screen ist repariert.

### 2. Cloudflare-Secret `SUPABASE_SERVICE_ROLE_KEY` — GESETZT (19. Aug) ✅

**Live verifiziert (19. Aug, nach Deploy):** `GET https://corso-app.pages.dev/invite/__check` → `200 {"ok":true, schritt1/2/3 alle "ok", "keySource":"cloudflare-binding"}`. Gegenprobe: `/invite/<fake>` → `?invite_error=invalid` (vorher `=error`) — der Worker kommt jetzt an die DB.

`keySource: cloudflare-binding` heißt: der Key kommt über `globalThis.__env__`, nicht über `process.env`. Der alte Code las **nur** `process.env` — ob das auf diesem Pages-Projekt überhaupt befüllt wird, ist damit weiterhin unbeantwortet und auch egal.

_Historie: bis dahin leer — das war die Ursache für `invite_error=error` beim Einlösen._

**Folge: das Einlösen von Einladungs-Links schlägt fehl** (`invite_error=error`). Da der Einladungs-Link der **Haupt-Onboarding-Weg für den Freundes-Pilot** ist, blockiert dieser eine fehlende Wert allein den Pilot-Start. Das Erzeugen der Links funktioniert auch ohne.

```bash
# 1. Key vorher rotieren (Punkt 3!), dann:
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name corso-app
# 2. Danach einmal neu deployen, damit die Env-Änderung greift:
bash scripts/deploy.sh
# 3. Prüfen (verbraucht keinen echten Link):
curl https://corso-app.pages.dev/invite/__check
```

Das ist das **einzige** Feature, das diesen Key braucht — der Tages-Prompt läuft seit 15. Juli über Client-RPC ohne service_role.

**Code-seitig vorbereitet (19. Aug):** `src/lib/invites/server.ts` liest den Key jetzt über `serverEnv()` — erst das Cloudflare-`env`-Binding (`globalThis.__env__`), dann `process.env`. Grund: Nitro reicht `env` **nicht** an den Server-Entry durch (der SSR-Service wird mit `fetch(request)` aufgerufen, ein Argument), und `process.env` befüllt Cloudflare nur bei nodejs_compat + hinreichend neuem Compatibility-Date — das Pages-Projekt pinnt beides nirgends im Repo (`dist/server/wrangler.json` wird von `deploy.sh` **nicht** mitkopiert). Damit hängt das Einlösen nicht mehr an dieser Einstellung.

### 3. Sicherheits-Altlast: Secrets rotieren 🔑

Diese Werte wurden im Chat geteilt und sind **noch nicht rotiert**:
- **service_role-Key** — am 19. Aug **erneut** im Chat geteilt. Rotation bewusst **aufgeschoben** (Entscheidung Maxim, 19. Aug), um den Pilot-Start nicht zu blockieren. ⚠️ Nachholen, **bevor** zahlende Fremde dazukommen — der Key umgeht sämtliche RLS-Regeln.
  Weg: Supabase → Projekt → Settings → API Keys → Reiter „Publishable and secret API keys" → neuen Secret Key (`sb_secret_…`) erzeugen, per `wrangler pages secret put` + lokale `.env` eintragen, deployen, dann Legacy-Keys deaktivieren. (Der Legacy-`service_role`-Key hat keinen eigenen Roll-Knopf — er hinge sonst am JWT-Secret, dessen Rotation auch den anon-Key tauscht und alle Sessions beendet.)
- ~~**service_role-Key** (Supabase → Settings → API → Roll)~~
- ~~Zwei Personal Access Tokens `sbp_9a4a…` und `sbp_2ab7…`~~ — **erledigt:** beide stehen im Dashboard auf *Expired* (geprüft 19. Aug), damit wirkungslos. Löschen ist Kosmetik.

### 4. Phase-1-Features, die noch fehlen

- **Discovery als langer Scroll-Feed** — Infinite Scroll + „heute zuerst"-Ordering (Details unten).
- **Push-Notifications** — 21:00-Push zum Stadt Corso + Push, wenn eine gefolgte Person postet. **Ohne Push gibt es keinen strukturellen Grund zurückzukommen**; die Kill-Metrik „Daily-Open-Rate ≥ 50 %" wäre ohne Push nicht fair messbar.

### 5. Nicht abschließend bewiesen

- Der **Scroll-Fix vom 12. August** ist nicht auf einem echten Handy verifiziert (nur Typecheck + Build grün, Ursachen im Code belegt).
- Der **Splash-Hänger-Fix** braucht zur endgültigen Bestätigung einen Aufruf >1 h nach dem letzten Login (Token-Lebensdauer).
- Ein **echter Zwei-Geräte-Test** des Einladungs-Links (Freund kommt rein? zweiter Klick blockiert?) steht aus — hängt an Punkt 2.

---

## Existierende Screens (Routes in `src/routes/`)

| Route | Screen | Stand |
|---|---|---|
| `index.tsx` | **Discovery** (Entdeckungs-Feed, vertikaler Swipe) | Echte Momente aus der DB, Follow schreibt in die DB, kein Mock-Fallback (ehrlicher Leerzustand). Eigene Momente raus (`author_id ≠ auth.uid()`), gefolgte Personen verlassen den Feed. Zahnrad oben rechts → `/settings`. **Offen:** hartes `limit 20` ohne Pagination/Tages-Ordering. |
| `story.tsx` | **Stadt Corso** (21:00-Ritual) | Liest die stadtweit eingefrorene Auswahl über `city_story()`; serverseitige gewichtete Ziehung um 21:00 via pg_cron. Leerzustand mit atmosphärischem Video-Hintergrund (cross-fadende s/w Düsseldorf-Clips, körnig, Blue-Hour-Tint, `blur(5px)`) + großem `Std:Min:Sek`-Countdown auf die nächste 21:00. Läuft die Story, zeigt eine dezente Pille oben „Stadt Corso · noch X h Y min" bis zur nächsten Ziehung. 🔒 Keine Follower-/Reaktions-Zahlen. |
| `record.tsx` | **Aufnahme** (echte Live-Kamera) | Kamera-first: Auto-Start beim Betreten, full-bleed Live-Bild, Prompt-Overlay im **Editorial-Stil** (System-Serif, linksbündige Magazin-Headline, Kursiv-Label „Heute", weicher Scrim), runder Auslöser mit Fortschrittsring bis 15 s, freundliche „Zugriff verweigert"-Karte mit iOS-Anleitung. Freigabe für den Stadt Corso als kompakte Pille, **erscheint erst nach der Aufnahme**. Tages-Prompt aus `get_today_prompt()`. Echo-Fix: beim Stopp wird der Live-Stream beendet, die Vorschau spielt die echte Aufnahme. 🔒 Kein Galerie-Upload. |
| `connections.tsx` | **„Ich folge"** / verdienter Chat | Echter Follow-Graph. Anstupsen + Follow-Erneuern schreiben in die DB. Entfolgen per Tippen auf „folgst du heute" (`unfollow()` setzt `expires_at = now()`) → Person taucht wieder in Discovery auf. Verdienter Chat = Phase 3, noch nicht gebaut. |
| `feedback.tsx` | **Rücklauf** (private Reichweite) | Zwei private Kennzahlen: **Publikum** (aktive Follower) + **Zuschauer** (eindeutige Betrachter des letzten Moments inkl. anonymer Pool-Zuschauer), je mit neutralem „seit gestern"-Delta (↑/↓/–, kein Rot, kein trauriges Icon). Bewusst nur zwei Zahlen — „Follower" und „Publikum" wären identisch. Dein aktueller Moment läuft als Video-Hintergrund, die Zahlen als ruhiges Overlay. Zeigt zusätzlich den **Prompt, zu dem der Moment entstand** (Auflösung über `posts.prompt_date` → `daily_prompt.corso_day` → `prompts.text`, mit Label „Heute"/„Gestern"/Datum). |
| `settings.tsx` | **Einstellungen** (Screen 10, minimal) | Vier bewusst schmale Blöcke: Benachrichtigungen (`push_enabled`-Switch), Sicherheit (Blockierte-Personen-Platzhalter), Rechtliches (`/impressum`, `/datenschutz`, `/agb`), Account (Anzeigename, Abmelden, manuelle Kontolöschung per Mailto). ✅ Seit `0014` (19. Aug angewendet) voll funktionsfähig — Push-Präferenz und Anzeigename schreiben durch. |
| `impressum/datenschutz/agb.tsx` | Rechts-Platzhalter | Gemeinsames Gerüst `src/components/legal-page.tsx`, Inhalt „folgt". |

---

## Deployment

**URL:** `https://corso-app.pages.dev` (Cloudflare Pages — läuft ohne MacBook, extern testbar; am 19. August mit HTTP 200 erreichbar)
**Plattform:** Cloudflare Pages, Preset `cloudflare-module`, Worker-SSR mit Assets-Binding

```bash
bash scripts/deploy.sh
```

Das Script baut mit `NODE_ENV=production`, prüft dass kein `jsxDEV` im Bundle landet, baut `deploy/` aus `dist/` zusammen und deployt via Wrangler. **Keine manuellen Patches mehr.**

**Voraussetzungen:** Wrangler eingeloggt (`npx wrangler whoami` → tools@subworx.io) und Node/npm vorhanden. `bun` ist optional (Script fällt auf npm/vite zurück).

**Beim Nachtesten:** Cloudflare-Edge + Browser cachen die alte HTML kurz. Ein frischer Besucher bekommt sofort die neuen Bundle-Hashes; beim eigenen Nachtesten ggf. hart neu laden.

### Warum das früher kaputt war (gelöst 2. Juli)

`.env` setzt `NODE_ENV=development`. Beim `vite build` ließ das den JSX-Transform die **Dev-Runtime** nutzen → überall `jsxDEV(...)`-Aufrufe, während React als Produktion gebaut wird und `jsxDEV` auf `void 0` setzt. Beim Rendern jeder Route: `TypeError: (void 0) is not a function`. Die früheren Splash-/jsxDEV-Patches waren Flickwerk und deckten nur das Haupt-Bundle ab — deshalb kam man bis zum Login, aber jede echte Route crashte. Der Fix erzwingt `NODE_ENV=production` nur für den Build; `.env` bleibt unangetastet.

---

## Architektur & Mechanik im Detail

### Ziehung für den Stadt Corso (live seit 15. Juli, `0005_city_story_draw.sql`)

- **Kandidaten (serverseitig gefiltert):** alle **lebenden** Momente (`expires_at > now()`, also jünger als 24 h) **mit** `city_story_consent = true`, Autor in der Zielstadt. 🔒 Consent wird in der SQL-Funktion erzwungen, nicht im Client. *(Bis 19. Aug: `prompt_date = corso_day()`.)*
- **Ein Moment kann höchstens von EINER Ziehung gesehen werden** — Ziehungen liegen 24 h auseinander, genau wie die Lebensdauer.
- **Gewicht je Moment:** `w = 1 + ln(1 + aktive_follower)`. Neuling (0 Follower) → `w = 1.0` (reale Grundchance); 50 Follower → `w ≈ 4.9`. Log = abnehmender Grenznutzen, keine Rangliste. Ziehung ohne Zurücklegen (Efraimidis-Spirakis: `random()^(1/w)`, die 8 größten gewinnen). 🔒 Die Follower-Zahl wird **inline** gezählt und verlässt die Funktion nie.
- **Verifiziert (Monte-Carlo, 2000 Läufe):** Neuling mit 0 Followern kommt an ~36 % der Tage rein; ein „Whale" mit 800 Followern an 95 % — trotz 800× Follower nur ~2,6× die Chance.
- **Eingefroren & stadtweit identisch:** `draw_city_story(city, force)` schreibt bis zu 8 Slots nach `city_story_slots`. `force=false` ist idempotent (deckt „Cron doppelt gelaufen" ab).
- **Zeit:** pg_cron `city-story-draw-summer` (19:00 UTC) + `city-story-draw-winter` (20:00 UTC); `run_city_story_draw()` prüft selbst `= 21 Uhr Berlin` und no-opt sonst → DST-sicher exakt 21:00.
- **Lesepfad:** über `city_story()` (SECURITY DEFINER), nicht direkt über die Tabelle — die eingefrorenen Stadt Corso überlebt den 24h-Verfall ihrer Clips. 🔒 Nur Anzeige-Daten, keine Zahlen.
- **Dev-Werkzeuge (nur Test):** `select draw_city_story('Düsseldorf', true);`, Seed `select dev_seed_city_story('{0,0,1,3,8,20,60,150}');`, Aufräumen `select dev_clear_city_story_test();`.
- **In-App-Dev-Menü** (`0006` + `src/components/dev-menu.tsx`): Ribbon-Button **nur für `dominik@subworx.io`**, Drawer mit fünf Aktionen (Stadt Corso ziehen / zurücksetzen / Follows verfallen / Fake-Momente seeden / Fake-Daten löschen), jede mit Bestätigungs-Schritt. Läuft über Admin-gegatete `dev_menu_*`-Wrapper (`is_dev_admin()` prüft die E-Mail serverseitig).
- **🔒 Security-Fix in `0006`:** Supabase-Default-Grants hatten die Roh-Funktionen aus `0005` faktisch für **jeden** `authenticated`/`anon` aufrufbar gemacht (ein `revoke from public` griff nicht gegen die expliziten Rollen-Grants). `0006` sperrt `execute` für anon/authenticated zu — nur postgres/service_role und die Admin-Wrapper rufen sie noch auf. Verifiziert via `has_function_privilege`.
- **Zukunftssicher:** Ziehung läuft pro Stadt (`profiles.city`); weitere Städte brauchen keine Migration.

### Follower-Zahl-Privatsphäre (RLS-Audit, 15. Juli)

🔒 Die private Publikums-/Follower-Zahl ist **serverseitig** nur für den Nutzer selbst lesbar. Das ist keine UI-Kosmetik.

- **Schutz-Mechanik:** `follows`-SELECT-Policy `follower_id = auth.uid()` (niemand sieht, wer IHM folgt) + `my_reach()` / `my_feedback()` als `SECURITY DEFINER` **ohne Parameter** (zählen nur `auth.uid()` — es gibt keinen Weg, jemand anderen abzufragen) + `reach_snapshots`-Policy `read_own`.
- **Live gegen anon geprüft:** `follows`, `reach_snapshots`, `profiles`, `nudges`, `city_story_slots`, `connections` → alle `count=0` für Unauthentifizierte. Test: `scripts/security-test-follows.mjs`.
- **Eine Looseness gefunden + gehärtet:** `my_reach()` war für anon ausführbar (lieferte harmlos `0`). `0004_reach_grant_hardening.sql` angewendet → revoke public/anon, nur authenticated, plus expliziter `auth.uid() is null → 0`-Guard.
- ✅ **Zwei-User-Beweis erbracht** (residue-frei, in-DB via simulierte JWT-Claims, alles zurückgerollt): A hat 1 aktiven Follower → Angreifer B zählt via `followee_id=A` **0**, B's `my_reach` = B's eigene, A's `my_reach` = **1**. B kommt über keinen Pfad an A's Zahl.
- **Bewusst NICHT geändert:** `follows_update_own` — das Zurücksetzen von `expires_at` ist der legitime `renew()`-Pfad; eine Policy dagegen würde Erneuern brechen und ist keine Privatsphäre-Frage.

### Täglicher Prompt aus der DB

- **40 leichte, filmbare Prompts** mit Kategorie-Hebel `zeig` / `augenzwinkern` / `funken` (14/16/10). Die 50 alten introspektiven Prompts sind **deaktiviert, nicht gelöscht** (Audit bleibt heil).
- **`get_today_prompt()`** (SECURITY DEFINER, atomar mit Advisory-Lock) zieht **gewichtet ~40/40/20**, **nie zweimal hintereinander**, friert pro Corso-Tag ein und protokolliert in `daily_prompt` — Grundlage, um Moment-Raten pro Prompt zu messen. Über 60 simulierte Tage verifiziert: 0 Doppel, Gewichtung stimmt, alle 40 rotieren.
- ⚠️ **`prompts.active_date` ist seit `0013` nur noch ein LRU-Marker**, keine Historie. Wer wissen will, welcher Prompt an welchem Tag lief, muss `daily_prompt` lesen. Kein Rückfall auf `active_date` bauen — er zeigt den falschen Prompt.
- **Frontend (Client-RPC, KEIN Server-Secret):** `useTodayPrompt` ruft `get_today_prompt()` per `supabase.rpc` mit anon-Key + User-JWT auf. Bewusst gegen die ursprüngliche Server-Action getauscht, um den service_role-Key aus dem Edge zu halten. Geteilter Query-Key → ein Call für Splash + Kamera-Overlay.
- **`DailyPromptSplash`** (Vollbild, 3 s auto-aus, localStorage `corso_last_prompt_seen` = Corso-Tag, SSR-sicher): Hintergrund = `CityBackdrop` (dieselben geblurrten s/w Clips wie der Leerzustand des Stadt Corso), einen Tick dunkler, dezenter Glas-Container um den Prompt.
- **Migrationen:** `0008` (Umbau `prompt_date` → `active_date`), `0011` (Enum, `active`-Flag, `daily_prompt`, gewichtete Rotation, View `prompt_performance`), `0012` (Seed), `0013` (LRU-Marker).

### Rücklauf-Datenpfad

- Alles über `my_feedback()` (SECURITY DEFINER, argumentlos, RLS-privat).
- Ansichten anonym via `post_views` + `record_view()` — Discovery/Stadt Corso/Ich-folge feuern beim aktiven Clip.
- **500-ms-Verweil-Schwelle** vor dem Verbuchen: Vorbeiziehen zählt nicht, Landen schon. (Nötig geworden, weil der Scroll-Fix vom 12. August den aktiven Index früher wechseln lässt — „Zuschauer" ist Kill-Metrik und darf nicht durch Vorbeiscrollen aufgeblasen werden.)
- „seit gestern"-Basis: nächtlicher `snapshot_reach()`-Cron (`5 7 * * *` UTC).
- Migration `0010`, Negativ-Test `scripts/security-test-feedback.mjs`.

---

## Rollender 24h-Verfall (umgestellt 19. August, `0015_rolling_24h_expiry.sql`)

**Die zentrale Konzept-Änderung: es gibt keinen stadtweiten Reset mehr.** Vorher startete die ganze Stadt um 08:00 gemeinsam bei null (alle Follows verfielen per Cron, Discovery war leer). Jetzt trägt jeder Datensatz seine eigene Uhr.

### Die Regeln

| Was | Regel | Wo erzwungen |
|---|---|---|
| Moment | lebt **24 h ab dem Post** (`posts.expires_at = created_at + 24 h`) | Trigger `posts_enforce_expiry` + RLS `posts_read_living` |
| Follow | lebt **24 h ab dem letzten (Re-)Follow** | Trigger `follows_enforce_expiry` |
| Erneuern | erst ab **12 h** Follow-Alter | Trigger + `canRenew()` im Client |
| Ein Moment pro Person | ein neuer Post beendet den bisherigen sofort | Trigger `posts_single_living` |
| Zyklus (Prompt + Ziehung) | **21:00 → 21:00** Berlin | `corso_day()` (`- interval '21 hours'`) |

### Warum Query-Filter statt Verfalls-Cron

Verfall wird **ausschließlich über `expires_at > now()`** in Queries und Funktionen gerechnet. Ein Markier-Cron (auch minütlich) hätte ein Lag-Fenster, in dem die DB tote Momente noch als lebend ausliefert — bei individuellen Timern wäre das ein Dauerzustand, kein Randfall. `expires_at` **ist** die Markierung. 🔒 Nichts wird gelöscht: abgelaufene Rows bleiben vollständig erhalten und sind für Pilot-Metriken auswertbar (man sieht exakt, wann was gestorben ist).

### 🔒 Die Sicherheitslücke, die die neue Semantik aufgerissen hätte

`posts_update_self` und `follows_update_own` erlauben dem Nutzer, seine eigene Zeile zu ändern. Solange `expires_at = NULL` „aktiv" hieß, war das harmlos. Mit einem **Zukunfts**-Zeitstempel hätte ein präparierter Client `expires_at = now() + 10 years` schreiben können → Moment lebt ewig, Publikum verfällt nie. Das verletzt zwei 🔒 Leitplanken. Die BEFORE-Trigger schließen das: **Vorziehen erlaubt** (entfolgen, Moment beenden), **Verlängern nie**. Live verifiziert, alles zurückgerollt:

```
A) Moment-Verfall verlaengern: GEBLOCKT     D) Lebensdauer neuer Moment: 1 day
B) Moment-Verfall vorziehen:   ERLAUBT      E) Follow-Verfall verlaengern: GEBLOCKT
C) Lebende Momente nach Neupost: 1          F) Erneuern vor 12h: IGNORIERT
```

### ⚠️ Semantik-Kippe bei `follows.expires_at`

Die Spalte gab es schon, sie bedeutet jetzt aber das Gegenteil:
- **ALT** (`0003`): `NULL` = aktiv, Zeitstempel = verfallen
- **NEU** (`0015`): Zeitstempel in der **Zukunft** = aktiv, Vergangenheit = verfallen

Jede Abfrage mit `.is("expires_at", null)` liefert ab jetzt **null aktive Follows**. Alle bekannten Stellen sind mitgezogen (`my_reach`, `my_feedback`, `snapshot_reach`, `draw_city_story`, `follow-context.tsx`). Wer neuen Code schreibt: **immer `expires_at > now()`**.

### Was der Verfall NICHT betrifft

- 🔒 **`connections`** (Dating-Anbahnung) — bleibt unangetastet, verfällt nie.
- **Anstupsen** — Limit „1 pro Person pro Zyklus" hängt weiter am 21:00-Zyklus, nicht an der 24h-Uhr.
- **Prompt-Historie** (`daily_prompt`) — eine Zeile pro Zyklus, unverändert.
- **Die Mediendatei im Storage** — bleibt liegen. Die 24 h werden auf Datensatz-Ebene erzwungen, nicht auf Datei-Ebene (nötig für die eingefrorenen Stadt Corso, und entspricht dem „nicht löschen"-Prinzip).

### Stadt-Corso schlägt Verfall

Ein gezogener Moment bleibt die **ganze Story lang sichtbar** (21:00 bis zur nächsten Ziehung), auch wenn seine 24 h währenddessen ablaufen. In Discovery/Ich folge/Rücklauf ist er dann weg, im Stadt Corso steht er weiter — ein Moment kann so bis zu ~48 h im Corso stehen. Deshalb liest die Story über `city_story()` an der RLS vorbei. Damit die Kill-Metrik dabei nicht lügt, zählt `my_feedback()` die Zuschauer des Moments, der **gerade sichtbar ist** (lebend ODER im laufenden Corso) — sonst zeigte der Rücklauf 0 Zuschauer, während die halbe Stadt den Clip sieht (`latest_visible_post()`).

---

## Discovery-Feed — Umfang & Verhalten

**Vision:** Discovery ist ein **langer Scroll-Feed**, der ein ausgedehntes Scrollverhalten etabliert — nicht ein knappes Kartendeck.

- **Inhalt:** alle **lebenden** Momente der Stadt (jünger als 24 h), neueste zuerst. Kein Tagesfilter mehr nötig — die 24h-Uhr ist der Filter.
- **Laden:** **Infinite Scroll** (gebaut 19. Aug): `useInfiniteQuery` + `range()`, 20 pro Seite, nachgeladen 3 Kacheln vor dem Ende.
- **Area:** = **ganze Stadt Düsseldorf** (Pilot) → Area-Filter vorerst No-Op. Feinere Area (Stadtteil/Radius) bewusst NICHT jetzt.
- **Bestehende Regeln bleiben:** eigene Momente raus, gefolgte Personen verlassen den Feed.
- ⚠️ **Der Feed kann leer sein.** Bei aktuell 2 lebenden Momenten ist er es fast. Das ist die gewollte Regel (Entscheidung 19. Aug: „alte Momente sind weg") und **kein Auftrag, mit älteren Momenten aufzufüllen** — die frühere Interim-Regel „ältere als Nachschub" ist damit hinfällig.

---

## Login: Code statt Link (19. Aug 2026)

**Problem:** Auf dem iPhone hat eine Home-Bildschirm-PWA einen eigenen Speicher, getrennt von Safari. Ein angetippter Magic-Link öffnet immer in Safari → die Session landet dort, die PWA bleibt dauerhaft ausgeloggt. Symptom: „ich muss mir jedes Mal einen neuen Link schicken lassen". Belegt durch die Nutzerliste: 4 von 12 Konten haben sich **nie** eingeloggt, obwohl sie angelegt wurden.

**Lösung:** 6-stelliger Code, eingetippt **in** der App → Session entsteht dort, wo sie hingehört. Link bleibt als Rückfall für Desktop/Android.

- `auth-context.tsx`: `signInWithMagicLink` → `requestLoginCode` + `verifyLoginCode` (`verifyOtp`, `type: "email"`).
- `auth-gate.tsx`: LoginScreen in zwei Schritten (E-Mail → Code), mit „erneut schicken" und „andere E-Mail". Eingabe erlaubt 6–8 Ziffern, damit eine spätere Änderung von `mailer_otp_length` nicht still bricht.
- **Supabase-Konfiguration** (per Management-API gesetzt): Magic-Link-Vorlage auf Deutsch mit `{{ .Token }}` **und** `{{ .ConfirmationURL }}`, Betreff `{{ .Token }} ist dein Corso-Code` (iOS zeigt den Code dann in der Mitteilung), `mailer_otp_length` 8 → **6**.

**🔒 Nebenbei geschlossen: offene Registrierung.** `signInWithOtp` lief ohne `shouldCreateUser: false` — jede beliebige E-Mail bekam einen Link und ein Konto, am Einladungs-System vorbei. Jetzt: „Diese E-Mail ist nicht eingeladen." Der Einladungs-Link ist die einzige Tür.

**Session-Lebensdauer** (live aus der Auth-Config): `sessions_timebox: 0`, `sessions_inactivity_timeout: 0`, `jwt_exp: 3600` mit Auto-Refresh → einmal eingeloggt, dauerhaft eingeloggt.

**Zusätzlich gefixt:** Die 8-Sekunden-Notbremse in `auth-context.tsx` verwarf bei langsamem Netz eine **gültige** Session und zeigte den Login. Jetzt gibt sie nur die Oberfläche frei und übernimmt ein verspätetes Ergebnis nachträglich (`raceTimeout` statt `withTimeout`).

⏳ **Offen:** echter Test auf dem iPhone — Code eintippen, App schließen, wieder öffnen, direkt drin sein.

---

## Einladungs-Links (E-Mail-frei) — ⚠️ PILOT-PROVISORIUM

**Zweck:** Für den gratis Freundes-Pilot umgehen wir E-Mail komplett. Maxim verschickt pro Freund einen persönlichen Link per WhatsApp → Klick = eingeloggt, ohne Code, ohne Mail.

**⚠️ Bewusste Übergangslösung mit Verfallsdatum — KEINE dauerhafte Auth-Architektur.** Der spätere zahlende Fremden-Pilot bekommt echte Self-Service-Registrierung. Nicht als Fundament weiterbauen. So markiert in `0009_invites.sql`, `src/lib/invites/server.ts`, `src/server.ts`, `scripts/make-invites.mjs`.

**Bausteine:**
- **`invites`-Tabelle** (`0009`, live): `token` (kryptografisch zufällig), `friend_name`, `friend_email`, `expires_at` (7 Tage), `redeemed_at`/`redeemed_by`. 🔒 RLS an, KEINE Policy + Grants entzogen → nur `service_role` kommt ran; Tokens sind nicht auflistbar.
- **Erzeugen (lokal):** `scripts/make-invites.mjs` liest `scripts/friends.txt` (`Name, email` pro Zeile, gitignored) + service_role aus lokaler `.env` → druckt fertige Links.
- **Einlösen (serverseitig, CF-Worker):** `src/server.ts` fängt `/invite/<token>` ab → prüft/beansprucht Token atomar, `admin.generateLink({type:'magiclink'})` (legt User an), leitet zum Supabase-Verify → Session in der App. 🔒 Einmal-Verwendung + 7-Tage-Ablauf. Der service_role-Key bleibt im Worker; nach außen geht nur der einmalige action_link.
- **Fehler-UX:** ungültig/abgelaufen/benutzt → Redirect auf `/?invite_error=…` → klare Meldung im LoginScreen. Bei `error` zusätzlich `&why=nokey|dbread|claim|link&detail=<kurztext>`, im LoginScreen als zweite Zeile sichtbar — vorher kollabierten alle vier Ursachen auf denselben Satz und der Flow scheiterte still.
- **Selbsttest:** `GET /invite/__check` → JSON `{ok, hasServiceRoleKey, keyLength, keySource}`. Sagt nur OB ein Key da ist, nie den Key. Für den Check nach dem Setzen des CF-Secrets, ohne einen echten Link zu verbrennen.
- **E-Mail-Login bleibt** als Rückfall.

**Verifiziert:** DB-Sperre (anon → `permission denied for table invites`), Live-Route greift (`/invite/<fake>` → 302 mit Fehler), Einlöse-Logik in SQL (gültig → einlösbar; zweiter Versuch/abgelaufen/benutzt → 0), Erzeugungs-Skript end-to-end, kein Key-Leak im Client-Bundle.

**Zusätzlich verifiziert (19. Aug, lokal gegen das gebaute Server-Bundle mit echtem Key):** `/invite/__check` → `200 {"ok":true,"keySource":"process.env"}`; unbekanntes Token → `302 /?invite_error=invalid` (in Prod kommt hier heute `error`, weil der Key fehlt — genau der Unterschied, der die Diagnose beweist). Der Rest der Kette (`generateLink` für eine **neue** E-Mail) ist weiterhin unbewiesen und wird erst beim echten Zwei-Geräte-Test klar; `disable_signup` ist live `false`, die Voraussetzung stimmt also.

⛔ **Nicht funktionsfähig, solange das CF-Secret fehlt** (Offener Punkt 2). Die `invites`-Tabelle ist mit 0 Zeilen leer — es wurde noch kein einziger echter Link erzeugt.

---

## E-Mail-Versand (Magic-Link via SendGrid)

**Stand:** Custom SMTP über SendGrid aktiv, Login-Mails landen seit 15. Juli **im Posteingang** (vorher Spam).

| Feld | Wert |
|---|---|
| Host / Port | `smtp.sendgrid.net` : `587` (STARTTLS) |
| SMTP-User | `apikey` |
| Absendername | `Corso` |
| Absender-/Admin-Mail | `dominik@subworx.io` |
| Rate-Limit | 100 Mails/Stunde |
| Link-Gültigkeit | 3600 s (1 h) |

Der genaue Fix-Weg wurde nicht protokolliert. Die Diagnose-Historie steht unten als Referenz, falls das Problem wiederkehrt.

<details>
<summary><strong>🔍 Diagnose-Historie (7. Juli) — als Referenz aufbewahrt</strong></summary>

**Symptom:** „Login-Link-Mail kommt nicht an." Mails wurden gesendet UND zugestellt — landeten aber in Junk/Quarantäne. Also ein Inbox-Placement-Problem, kein Versandproblem.

**Wichtig, weil eine Zwischenthese falsch war:** Die These „Domain nicht authentifiziert" war **falsch**. Der erste `dig` suchte `s1/s2._domainkey` — der Account liegt aber in der **SendGrid-EU-Region**, die Selektoren heißen `eus1/eus2._domainkey` und lösen sauber auf.

Per SendGrid-API verifiziert: `subworx.io` → valid, DKIM1/DKIM2/SPF alle valid, DMARC-aligned. Alle Suppression-Listen leer. Activity Feed: Status `delivered` — der Empfänger-Server hat mit 250 OK angenommen. `delivered` ≠ Posteingang.

**Gmail-Hauptursache:** **Kein Link-Branding** + **aktives Click-Tracking** → SendGrid schrieb den Login-Link auf einen `*.sendgrid.net`-Redirect um. Ein Login-Link über eine fremde Tracking-Domain ist ein starkes Gmail-Spam-Signal (Phishing-Muster). Dazu die englische Supabase-Default-Vorlage. Auth und Reputation waren tadellos.

**Zwei Wege zum selben Ziel (den `sendgrid.net`-Redirect loswerden):**
- **A) Tracking global aus** (kein DNS, sofort): Login-Link bleibt die rohe `supabase.co`-URL. Kosten: andere Projekte verlieren Klick-/Öffnungs-Statistik.
- **B) Link-Branding `link.subworx.io`** (braucht IONOS-DNS): Root-Branding auf `subworx.io` greift nur für exakte `@subworx.io`-Absender, andere Subdomain-Absender bleiben unberührt.
- „Tracking nur für Corso aus" ist NICHT möglich (Tracking ist kontoweit).

**Reste:** Link-Branding-Eintrag in SendGrid angelegt (id `5500551`, `valid=false` = inert, jederzeit löschbar); ausstehende CNAMEs wären `link.subworx.io → sendgrid.net` und `39222136.subworx.io → sendgrid.net`. Deutsche Vorlage `supabase/templates/auth_email_de.html` geschrieben, aber nie in Supabase eingespielt. Tote Whitelabel `mail.subworx.io` (valid=False) sollte gelöscht werden.

**Sofort-Entblocker ohne Mail:** Login-Links per Admin-API (`POST /auth/v1/admin/generate_link`, service_role) generieren und `action_link` direkt an den User geben.
</details>

---

## Supabase / Cloudflare Redirect-URLs

- Supabase Site-URL: `https://corso-app.pages.dev`
- Redirect-Allowlist: `https://corso-app.pages.dev/**`, `https://*.corso-app.pages.dev/**`, `https://*.ngrok-free.app/**`
- Für iPhone-Tests lokal: ngrok-URL in `.env` als `VITE_APP_URL` — die Allowlist deckt `*.ngrok-free.app` bereits ab.

---

## Lovable-Sandbox für Design des Stadt Corso

Zum gefahrlosen visuellen Iterieren gibt es eigenständige Vorschau-Routen mit Mock-Daten, ohne Supabase/Auth — der echte `story.tsx` bleibt unangetastet:

- **`src/routes/story-empty-lab.tsx`** (`/story-empty-lab`) — der Leerzustand des Stadt Corso. Look ist fertig iteriert und nach `story.tsx` zurückportiert; die Lab-Route bleibt zum Weiter-Schrauben. **Wer hier am Look schraubt, muss Änderungen von Hand nach `story.tsx` zurücktragen** (beide Dateien halten den Countdown und den `blur`-Wert redundant synchron).
- **`story-lab.tsx`** (Story-Karten-Sandbox) liegt **nur auf dem Branch `story-experiments`**, nicht auf `main`. Lovable arbeitet auf diesem Branch; guter Look wird manuell nach `story.tsx` zurückportiert.

---

## Chronik der gelösten Bugs

<details>
<summary><strong>12. August — Scroll-Verhalten in Discovery/Stadt Corso/Ich-folge repariert</strong></summary>

**Symptom:** Beim Hochwischen wurde kurz noch der bisherige Moment als aktiver gezeigt, bevor er verschwand; der neue wirkte dabei „eingefroren". Zusätzlich beim allerersten Aufruf am Tag ein verrutschtes/klemmendes Scrollen, das sich nach einem Reload gab.

**Ursache 1 — aktiver Index lief der Geste hinterher (`use-snap-scroll.ts`).** `setCurrentIndex()` wurde erst am **Ende** der 380-ms-Snap-Animation gesetzt. `currentIndex` steuert aber `isActive` → welches Video spielt. Während des ganzen Wischens plus Snap lief also noch der alte Moment, während der Ziel-Moment pausiert danebenstand. **Fix:** neuer `commitIndex()`, der sofort greift — beim Überqueren der Hälfte während des Wischens und beim Start von `snapTo`.

**Ursache 2 — Gesten-Listener hingen global am `window`.** `<DailyPromptSplash/>` ist in `__root.tsx` ein **Geschwister** des Feed-Containers und liegt als `fixed inset-0 z-[100]` darüber (3,5 s, einmal pro Corso-Tag). Jeder Wisch darauf steuerte den Feed darunter fern. Erklärt exakt „nur beim ersten Aufruf" und „weg nach Reload" — der Splash schreibt seinen localStorage-Merker sofort beim Anzeigen. **Fix:** `containerRef` aus dem Hook, in allen drei Screens am Feed-Container; Gesten außerhalb werden ignoriert. Splash zusätzlich auf `touch-action: none`.

**Ursache 3 — Maß aus `window.innerHeight`,** während das Layout `h-dvh` nutzt. Auf dem Handy driften die zwei beim Ein-/Ausfahren der Browser-Leiste auseinander → Slides sitzen versetzt. **Fix:** Maß aus `containerRef.clientHeight` + `ResizeObserver` am Container.

**Bewusst abgefangene Nebenwirkung:** siehe die 500-ms-Verweil-Schwelle oben.

**Offene Restspur,** falls es weiter ruckelt: Discovery lädt bis zu 20 `<video>`-Elemente gleichzeitig mit Standard-`preload` — auf Mobilfunk potenziell zäh.
</details>

<details>
<summary><strong>12. August — App hing beim ersten Aufruf im Splash</strong></summary>

Nur ein Reload half, auf MacBook wie Mobile. Ursache in `src/lib/auth-context.tsx`, zwei Defekte:

- `supabase.auth.getSession()` hatte **kein `.catch()` und keinen Timeout** — es ist die einzige Stelle, die `loading` aufhebt. Jede Rejection (Netz, Token-Refresh, Storage) = Splash für immer.
- Der `onAuthStateChange`-Callback war **`async` und lud darin das Profil** (wieder ein Supabase-Aufruf). supabase-js ruft den Callback auf, **während der interne Auth-Lock gehalten wird** → Verklemmung mit dem parallelen `getSession()`. Von Supabase ausdrücklich als Anti-Pattern dokumentiert. Erklärt, warum es nur beim *ersten* Aufruf auftrat: da ist der Token meist abgelaufen und muss per Netz erneuert werden — genau der Pfad, der den Lock hält.

**Fix:** Callback synchron, Profil-Laden per `setTimeout(…, 0)` außerhalb des Locks; `try/catch` + 8-s-Timeout um die initiale Session-Prüfung; `profilePending`-State gegen Aufblitzen des Handle-Screens; `pendingUserId` als Race-Schutz; nach 10 s ein „Neu laden"-Button als letzte Rückfalllinie.
</details>

<details>
<summary><strong>Ältere Fixes</strong></summary>

- **Aufnahme-Echo behoben** — beim Stopp wird der Live-Stream beendet (Mic zu, `srcObject` frei), die Vorschau spielt die echte Aufnahme statt weiter das Live-Bild mit Rückkopplung.
- **vaul-Drawer-Freeze im Dev-Menü** — auf `modal={false}` + `pointer-events`-Sicherheitsnetz umgestellt; kein Einfrieren mehr nach dem Splash.
- **Dev-Buttons aus der Discovery-Topbar entfernt** — Simulation nur noch über das Admin-Dev-Menü.
</details>

---

## Backend-Bausteine (Phase 0 — abgeschlossen)

1. ✅ **Backend-Stack: Supabase** (Auth + Postgres + Storage + pg_cron).
2. ✅ **Datenmodell** (`0001_init.sql`): profiles, prompts, posts, follows, nudges, city_story_slots, reach_snapshots inkl. RLS + `corso_day()` + `my_reach()`.
3. ✅ **Supabase-Projekt CORSO** (ref `uuhrylkvwosflyypbdbj`) live.
4. ✅ **`@supabase/supabase-js`** + SSR-sicherer Client (`src/lib/supabase/client.ts`).
5. ✅ **Bucket `moments`** + Storage-RLS (`0002_storage.sql`) — end-to-end mit Wegwerf-User verifiziert.
6. ✅ **Auth (Magic-Link):** `auth-context.tsx` + `auth-gate.tsx`, eingehängt in `__root.tsx`.
7. ✅ **Follow-Verfall:** `0003_follows_expiry.sql` (08:00-Reset, **abgelöst**) → `0015_rolling_24h_expiry.sql` (24 h ab Follow, ohne Cron). Test-Tools: `dev_menu_expire_my_follows()`, `dev_menu_expire_my_moment()`.
8. ✅ **Video-Upload** (`src/lib/supabase/upload.ts`): Upload → `posts`-Insert → signierte Read-URL, alles unter RLS. Kamera→MediaRecorder→Upload im echten Browser end-to-end verifiziert.
9. ✅ **Follow-Loop de-mockt:** `follow-context.tsx` lädt aus der DB statt aus localStorage-Seeds; alle Fake-Seeds und der Fake-Discovery-Fallback entfernt.
10. ✅ **Deploy-Script automatisiert** (`scripts/deploy.sh`).

---

## Offene Produkt-Entscheidungen, die jetzt relevant sind

- **Auth-Methode:** Hauptweg für den Freundes-Pilot ist der **E-Mail-freie Einladungs-Link**; der Magic-Link bleibt als Rückfall. Beides bewusst Pilot-Provisorium.
- **Privater Corso** (PRD #7) — das Push-Fenster 19–22 Uhr, Mechanik undefiniert. Wird relevant, sobald Push gebaut wird.
- **Verbindungs-Trigger bei verfallenden Follows** (PRD #8) — blockt erst Phase 3.
- **Geschlechter-Asymmetrie** (PRD #10) — strukturell das gefährlichste offene Produkt-Risiko, Mitigation offen.

---

*Diese Datei aktuell halten — sie ist der Einstiegspunkt für jeden neuen Kontext.*
