# Corso — Status

**Stand:** 2. Juli 2026 (Deploy gefixt + SendGrid geprüft)
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
| `index.tsx` | Discovery (Entdeckungs-Feed, vertikaler Swipe) | UI steht, Supabase-Follow-Logik live |
| `story.tsx` | Stadt-Story (20:00-Ritual) | UI steht, Mock-Clips |
| `record.tsx` | Aufnahme (echte Live-Kamera) | Kamera live; „Verwenden"-Upload noch disabled (kein Backend) |
| `connections.tsx` | Verbindungen / verdienter Chat | Platzhalter |
| `feedback.tsx` | Rücklauf (private Reichweite) | Platzhalter, Zahlen noch mock |

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

⏳ **Noch nicht verifiziert: tatsächliche Zustellung.** Hängt an der **Absender-Verifizierung in SendGrid** — `dominik@subworx.io` muss dort als Single Sender verifiziert *oder* Domain `subworx.io` per DKIM authentifiziert sein, sonst blockt SendGrid (403). Schnell-Test: auf der Live-URL eigene Mail eintragen → „Login-Link schicken" → kommt sie an (Absender „Corso")? Kein Zustelltest durchgeführt (bewusst, um Rate-Limit nicht anzufassen).

---

## Backend-Bausteine (Phase 0)

1. ✅ **Backend-Stack entschieden: Supabase** (Auth + Postgres + Storage + pg_cron).
2. ✅ **Datenmodell** (`0001_init.sql`): profiles, prompts, posts, follows, nudges, city_story_slots, reach_snapshots inkl. RLS + `corso_day()` + `my_reach()`.
3. ✅ **Supabase-Projekt CORSO** (ref `uuhrylkvwosflyypbdbj`) live, URL + anon-Key in `.env`. ⚠️ **Zu rotierende Secrets** (wurden im Chat geteilt): service_role-Key (Settings → API → Roll) **und** zwei Personal Access Tokens `sbp_9a4a…` / `sbp_2ab7…` (Account → Access Tokens → Revoke). PAT = Vollzugriff auf den ganzen Account.
4. ✅ **`@supabase/supabase-js` installiert** + Client: `src/lib/supabase/client.ts` (SSR-sicher).
5. ✅ **Supabase eingerichtet**: Migration eingespielt, Bucket `moments`, Auth aktiviert, Redirect-URL `https://corso-app.pages.dev` in Supabase.
6. ✅ **Auth (Magic-Link):** `src/lib/auth-context.tsx` + `src/components/auth-gate.tsx`, eingehängt in `__root.tsx`.
7. ✅ **Follow-Verfall (08:00-Reset):** `supabase/migrations/0003_follows_expiry.sql` — `expires_at`-Spalte, Zwei-Reset-Regel, pg_cron (`expire-follows-daily` täglich 07:00 UTC = 09:00 Berlin), `dev_expire_my_follows()` als Test-Tool. Alarm-Button (🔗) im Discovery-Screen für manuelle Simulation.
8. ⏳ Storage-RLS-Policies für `moments` (Upload/Read) → `0002_storage.sql`.
9. ⏳ Video-Upload in Bucket `moments` (macht „Verwenden"-Button funktional).
10. ⏳ Follow-Logik aus `src/lib/follow-context.tsx` vollständig ins Backend migrieren (Discovery-Feed aus echten Follows laden statt Mock).
11. ✅ **Deploy-Script automatisiert** (`scripts/deploy.sh`) — ein Befehl, Produktions-Build ohne jsxDEV-Crash, robuste Build-Runner-Erkennung, Sicherheitsnetz. Root-Cause (`NODE_ENV=development`) an der Wurzel behoben.

---

## Supabase / Cloudflare Redirect-URLs

- Supabase Site-URL: `https://corso-app.pages.dev`
- Redirect-Allowlist (verifiziert 2. Juli): `https://corso-app.pages.dev/**`, `https://*.corso-app.pages.dev/**`, `https://*.ngrok-free.app/**`
- Für iPhone-Tests lokal: ngrok-URL in `.env` als `VITE_APP_URL` — Allowlist deckt `*.ngrok-free.app` bereits ab

---

## Bekannte offene Entscheidungen, die jetzt relevant sind

- **Auth-Methode:** Magic-Link (E-Mail) ist aktiv und empfohlen für Freundes-Pilot.
- Stadt-Story-Größe/Frequenz bei kleinem Pilot (PRD #6) → blockt erst Phase 1.
- Verbindungs-Trigger bei verfallenden Follows (PRD #8) → blockt erst Phase 3.

---

*Diese Datei aktuell halten — sie ist der Einstiegspunkt für jeden neuen Kontext.*
