# Corso — Status

**Stand:** 15. Juli 2026 (Aufnahme-UI-Flow im echten Browser end-to-end verifiziert + Login-Mails landen jetzt im Posteingang → Phase 0 vollständig durch)
**Zweck:** Lebender Schnappschuss. Wer neu in das Projekt einsteigt (Mensch oder Agent), liest das hier zuerst und weiß, wo es steht und was der nächste konkrete Schritt ist. Diese Datei bei jedem nennenswerten Fortschritt aktualisieren.

> Reihenfolge zum Reinkommen: `CLAUDE.md` → `docs/PRD.md` (was & warum) → `docs/ROADMAP.md` (was als nächstes) → **diese Datei** (wo genau stehen wir).

---

## Wo wir stehen

**Phase:** **Phase 0 — Backend-Fundament** (laufend, siehe `docs/ROADMAP.md`).
**Insgesamt:** Supabase-Backend steht, Auth + Follow-Logik + täglicher Reset live. **Cloudflare-Deployment funktioniert vollständig** — der komplette Flow (Login → Magic-Link → Handle → alle 5 Screens) läuft live auf `https://corso-app.pages.dev`, extern testbar.

### ✅ Deployment-Problem GELÖST (2. Juli)
- **Wurzel-Ursache gefunden:** `.env` setzt `NODE_ENV=development`. Beim `vite build` ließ das den JSX-Transform (oxc/plugin-react in Vite 8) die **Dev-Runtime** nutzen → überall `jsxDEV(...)`-Aufrufe, während React als Produktion gebaut wird und `jsxDEV` auf `void 0` setzt. Ergebnis beim Rendern einer Route: `TypeError: (void 0) is not a function` → Fehler-Screen.
- Die früheren Splash-/jsxDEV-Patches waren Flickwerk und deckten nur das Haupt-Bundle ab (deshalb kam man bis zum Login, aber jede echte Route crashte).
- **Fix an der Wurzel:** `scripts/deploy.sh` erzwingt jetzt `NODE_ENV=production` für den Build. Damit wird gar kein `jsxDEV` mehr emittiert — **kein Patch mehr nötig**. `.env` bleibt unangetastet (NODE_ENV=development ist für den Dev-Server korrekt).
- Zusätzlich: `deploy.sh` nutzt kein `bun` mehr (auf dieser Maschine nicht installiert) → robuste Erkennung bun→npm→lokales vite, plus Sicherheitsnetz das bei `jsxDEV` im Bundle den Deploy abbricht.
- **End-to-end verifiziert im Browser** (2. Juli): Login-Screen → Magic-Link (Redirect-Allowlist ok) → Handle-Screen → Discovery + Story + Ich-folge + Aufnahme + Rücklauf rendern alle sauber, keine Konsolen-Fehler. Test-User danach wieder gelöscht.

### Existierende Screens (Routes in `src/routes/`)
| Route | Screen | Stand |
|---|---|---|
| `index.tsx` | Discovery (Entdeckungs-Feed, vertikaler Swipe) | Echte Posts aus der DB; Follow schreibt in die DB; **kein Mock-Fallback mehr** (ehrlicher Leerzustand). **Ziel = langer Scroll-Feed** (Entscheidung 15. Juli, siehe Abschnitt unten): Infinite Scroll, heute zuerst + ältere als Nachschub (interim), Endzustand nur heute. **Noch offen:** aktuell hartes `limit 20` ohne Pagination/Tages-Ordering. |
| `story.tsx` | Stadt-Story (20:00-Ritual) | **De-mockt (15. Juli):** liest die stadtweit eingefrorene Auswahl aus `city_story_slots`; serverseitige gewichtete Zufallsziehung um 20:00 via pg_cron. Kein Mock mehr. |
| `record.tsx` | Aufnahme (echte Live-Kamera) | Kamera live; „Verwenden"-Upload **funktional**; **UI-Flow im echten Browser end-to-end verifiziert (15. Juli): aufnehmen → hochladen → erscheint bei anderen in Discovery**. **Echo-Fix:** beim Aufnahme-Stopp wird der Live-Stream beendet (Mic zu, `srcObject` frei) → die Vorschau spielt die echte Aufnahme statt weiter das Live-Bild mit Rückkopplung. |
| `connections.tsx` | „Ich folge" / verdienter Chat | „Ich folge" aus **echtem Follow-Graph**; Anstupsen + Follow-Erneuern schreiben in die DB; **Entfolgen** per Tippen auf „folgst du heute" (`unfollow()` markiert `expires_at = now()`) → Person taucht wieder in Discovery auf; verdienter Chat = Phase 3 |
| `feedback.tsx` | Rücklauf (private Reichweite) | `my_reach()` echt; Pool-Zuschauer ausgeblendet (Phase 1) |

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
- ⏳ **Noch nicht live getestet im Browser** (Deploy + echter 20:00-Lauf mit echten einwilligenden Posts steht aus).

---

## Bekannte offene Entscheidungen, die jetzt relevant sind

- **Auth-Methode:** Magic-Link (E-Mail) ist aktiv und **zugestellt** — die Login-Mail landet seit 15. Juli im Posteingang (Spam-Problem behoben, Details im E-Mail-Abschnitt oben). Admin-Login-Links bleiben als Notfall-Option verfügbar, sind aber nicht mehr nötig.
- ~~Stadt-Story-Größe/Frequenz bei kleinem Pilot (PRD #6)~~ → **ENTSCHIEDEN (15. Juli):** Story läuft immer mit so vielen einwilligenden Clips wie da sind (max. 8, kein Mindest-Schwellwert); kein Fake-Auffüllen. Moderation im Freundes-Pilot bewusst ohne Sperr-Modell.
- Verbindungs-Trigger bei verfallenden Follows (PRD #8) → blockt erst Phase 3.

---

*Diese Datei aktuell halten — sie ist der Einstiegspunkt für jeden neuen Kontext.*
