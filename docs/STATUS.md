# Corso — Status

**Stand:** 7. Juli 2026 (Follow-Loop de-mockt + Upload live verifiziert; Login-Zustellung siehe E-Mail-Abschnitt)
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
| `index.tsx` | Discovery (Entdeckungs-Feed, vertikaler Swipe) | Echte Posts aus der DB; Follow schreibt in die DB; **kein Mock-Fallback mehr** (ehrlicher Leerzustand) |
| `story.tsx` | Stadt-Story (20:00-Ritual) | UI steht, **noch Mock-Clips** (echte Auswahl/Trigger = Phase 1) |
| `record.tsx` | Aufnahme (echte Live-Kamera) | Kamera live; „Verwenden"-Upload **funktional** (Backend 7. Juli verifiziert); UI-Flow noch nicht im echten Browser durchgeklickt |
| `connections.tsx` | „Ich folge" / verdienter Chat | „Ich folge" aus **echtem Follow-Graph**; Anstupsen + Follow-Erneuern schreiben in die DB; verdienter Chat = Phase 3 |
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

### ✅ ROOT CAUSE GEFUNDEN (7. Juli): Mails werden gesendet UND zugestellt — landen aber in Junk/Quarantäne (nicht Versand-, sondern Inbox-Placement-Problem)

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

## Backend-Bausteine (Phase 0)

1. ✅ **Backend-Stack entschieden: Supabase** (Auth + Postgres + Storage + pg_cron).
2. ✅ **Datenmodell** (`0001_init.sql`): profiles, prompts, posts, follows, nudges, city_story_slots, reach_snapshots inkl. RLS + `corso_day()` + `my_reach()`.
3. ✅ **Supabase-Projekt CORSO** (ref `uuhrylkvwosflyypbdbj`) live, URL + anon-Key in `.env`. ⚠️ **Zu rotierende Secrets** (wurden im Chat geteilt): service_role-Key (Settings → API → Roll) **und** zwei Personal Access Tokens `sbp_9a4a…` / `sbp_2ab7…` (Account → Access Tokens → Revoke). PAT = Vollzugriff auf den ganzen Account.
4. ✅ **`@supabase/supabase-js` installiert** + Client: `src/lib/supabase/client.ts` (SSR-sicher).
5. ✅ **Supabase eingerichtet**: Migration eingespielt, Bucket `moments`, Auth aktiviert, Redirect-URL `https://corso-app.pages.dev` in Supabase.
6. ✅ **Auth (Magic-Link):** `src/lib/auth-context.tsx` + `src/components/auth-gate.tsx`, eingehängt in `__root.tsx`.
7. ✅ **Follow-Verfall (08:00-Reset):** `supabase/migrations/0003_follows_expiry.sql` — `expires_at`-Spalte, Zwei-Reset-Regel, pg_cron (`expire-follows-daily` täglich 07:00 UTC = 09:00 Berlin), `dev_expire_my_follows()` als Test-Tool. Alarm-Button (🔗) im Discovery-Screen für manuelle Simulation.
8. ✅ **Storage-RLS-Policies** für `moments` (Upload/Read/Delete own) → `0002_storage.sql` **live angewendet** — 7. Juli end-to-end mit Wegwerf-User verifiziert (Upload in eigenen Ordner, Read authenticated).
9. ✅ **Video-Upload** in Bucket `moments` (`src/lib/supabase/upload.ts`): Upload → `posts`-Insert → signierte Read-URL laufen unter RLS durch (7. Juli verifiziert). ⏳ Rest: UI-Flow Kamera→MediaRecorder→Upload noch nicht im echten Browser durchgeklickt.
10. ✅ **Follow-Loop de-mockt** (7. Juli): `follow-context.tsx` lädt aktive Follows (`expires_at is null`) + Handles + heutige Anstupser aus der DB statt aus localStorage-Seeds; `follow()`/`renew()`/`nudge()` schreiben in die DB (DB-Write zentralisiert, aus `FollowButton` entfernt). Fake-Seeds **und** Fake-Discovery-Fallback (`TILES`) entfernt → Discovery + „Ich folge" zeigen nur echte Daten, sonst ehrlicher Leerzustand. Zwei-User-Follow-Loop (Follow-Write, Graph-Read, Nudge-Write) unter RLS verifiziert. `connections.tsx`: „Moment heute?" hängt jetzt am echten heutigen Video → Anstups-/Leerzustand wieder erreichbar.
11. ✅ **Deploy-Script automatisiert** (`scripts/deploy.sh`) — ein Befehl, Produktions-Build ohne jsxDEV-Crash, robuste Build-Runner-Erkennung, Sicherheitsnetz. Root-Cause (`NODE_ENV=development`) an der Wurzel behoben.

---

## Supabase / Cloudflare Redirect-URLs

- Supabase Site-URL: `https://corso-app.pages.dev`
- Redirect-Allowlist (verifiziert 2. Juli): `https://corso-app.pages.dev/**`, `https://*.corso-app.pages.dev/**`, `https://*.ngrok-free.app/**`
- Für iPhone-Tests lokal: ngrok-URL in `.env` als `VITE_APP_URL` — Allowlist deckt `*.ngrok-free.app` bereits ab

---

## Bekannte offene Entscheidungen, die jetzt relevant sind

- **Auth-Methode:** Magic-Link (E-Mail) ist aktiv. ⚠️ **Zustell-Vorbehalt:** die Login-Mail landet aktuell im Spam/Junk (SendGrid-`sendgrid.net`-Redirect + engl. Default-Vorlage — Details + Fix-Optionen im E-Mail-Abschnitt oben). Für den Freundes-Pilot bis dahin **Admin-Login-Links** manuell verteilen.
- Stadt-Story-Größe/Frequenz bei kleinem Pilot (PRD #6) → blockt erst Phase 1.
- Verbindungs-Trigger bei verfallenden Follows (PRD #8) → blockt erst Phase 3.

---

*Diese Datei aktuell halten — sie ist der Einstiegspunkt für jeden neuen Kontext.*
