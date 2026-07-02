# Corso — Status

**Stand:** 2. Juli 2026
**Zweck:** Lebender Schnappschuss. Wer neu in das Projekt einsteigt (Mensch oder Agent), liest das hier zuerst und weiß, wo es steht und was der nächste konkrete Schritt ist. Diese Datei bei jedem nennenswerten Fortschritt aktualisieren.

> Reihenfolge zum Reinkommen: `CLAUDE.md` → `docs/PRD.md` (was & warum) → `docs/ROADMAP.md` (was als nächstes) → **diese Datei** (wo genau stehen wir).

---

## Wo wir stehen

**Phase:** **Phase 0 — Backend-Fundament** (laufend, siehe `docs/ROADMAP.md`).
**Insgesamt:** Supabase-Backend steht, Auth + Follow-Logik + täglicher Reset live. Cloudflare-Deployment aufgesetzt, aber **Client-Rendering noch gebrochen** — App bleibt auf Splash hängen.

### ⚠️ Deployment-Problem offen
- SSR gibt HTTP 200 mit korrrektem HTML zurück ✓
- Client-JS lädt (`index-TM9Xe4Lp.js`, 571 kB) ✓
- **App hängt nach Hydration auf dem Splash-Screen** — Nutzer sieht nur "Corso"-Logo, kein Login-Screen
- Vermutliche Ursache: React 19 Production setzt `jsxDEV = void 0`; Patches für SSR und Client-Bundle wurden angewendet, aber App rendert trotzdem nicht weiter
- **Nächster Debug-Schritt:** Browser-DevTools → Console öffnen auf `https://corso-app.pages.dev` und genauen JS-Fehler sehen; der konkrete Fehler ist noch unbekannt

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

**URL:** `https://corso-app.pages.dev` (Cloudflare Pages — läuft ohne MacBook)
**Plattform:** Cloudflare Pages, Preset `cloudflare-module`, Worker-SSR mit Assets-Binding
**Deploy-Befehl:**
```bash
bun run build
npx wrangler pages deploy deploy --project-name corso-app --commit-dirty=true
```
**Hinweis:** `deploy/` wird manuell aus `dist/` zusammengebaut (Script: Schritt unten).
**Wichtig:** Nach jedem `bun run build` die `deploy/` Verzeichnis neu aufbauen und `react.mjs`-Patch anwenden (Details: vorherige Kontext-Session).

### Deploy-Skript (in Kürze: nächste Aufgabe)
Noch kein Bash-Script für den Build-Deploy-Zyklus. Manuell:
1. `bun run build`
2. `deploy/` löschen + neu befüllen aus `dist/`
3. `dist/server/_libs/react.mjs` patchen (`jsxDEV → jsx` Shim)
4. `dist/server/wrangler.json` compat-date auf `2025-01-01` patchen
5. `npx wrangler pages deploy deploy --project-name corso-app --commit-dirty=true`

---

## Backend-Bausteine (Phase 0)

1. ✅ **Backend-Stack entschieden: Supabase** (Auth + Postgres + Storage + pg_cron).
2. ✅ **Datenmodell** (`0001_init.sql`): profiles, prompts, posts, follows, nudges, city_story_slots, reach_snapshots inkl. RLS + `corso_day()` + `my_reach()`.
3. ✅ **Supabase-Projekt CORSO** (ref `uuhrylkvwosflyypbdbj`) live, URL + anon-Key in `.env`. ⚠️ service_role wurde im Chat geteilt → **rotieren** (Settings → API → Roll).
4. ✅ **`@supabase/supabase-js` installiert** + Client: `src/lib/supabase/client.ts` (SSR-sicher).
5. ✅ **Supabase eingerichtet**: Migration eingespielt, Bucket `moments`, Auth aktiviert, Redirect-URL `https://corso-app.pages.dev` in Supabase.
6. ✅ **Auth (Magic-Link):** `src/lib/auth-context.tsx` + `src/components/auth-gate.tsx`, eingehängt in `__root.tsx`.
7. ✅ **Follow-Verfall (08:00-Reset):** `supabase/migrations/0003_follows_expiry.sql` — `expires_at`-Spalte, Zwei-Reset-Regel, pg_cron (`expire-follows-daily` täglich 07:00 UTC = 09:00 Berlin), `dev_expire_my_follows()` als Test-Tool. Alarm-Button (🔗) im Discovery-Screen für manuelle Simulation.
8. ⏳ Storage-RLS-Policies für `moments` (Upload/Read) → `0002_storage.sql`.
9. ⏳ Video-Upload in Bucket `moments` (macht „Verwenden"-Button funktional).
10. ⏳ Follow-Logik aus `src/lib/follow-context.tsx` vollständig ins Backend migrieren (Discovery-Feed aus echten Follows laden statt Mock).
11. ⏳ **Deploy-Script automatisieren** (`scripts/deploy.sh`) — manueller Build-Patch-Deploy-Zyklus ist fehleranfällig.

---

## Supabase / Cloudflare Redirect-URLs

- Supabase Auth Redirect: `https://corso-app.pages.dev` (bereits gesetzt)
- Für iPhone-Tests lokal: ngrok-URL in `.env` als `VITE_APP_URL` + in Supabase allowlisten

---

## Bekannte offene Entscheidungen, die jetzt relevant sind

- **Auth-Methode:** Magic-Link (E-Mail) ist aktiv und empfohlen für Freundes-Pilot.
- Stadt-Story-Größe/Frequenz bei kleinem Pilot (PRD #6) → blockt erst Phase 1.
- Verbindungs-Trigger bei verfallenden Follows (PRD #8) → blockt erst Phase 3.

---

*Diese Datei aktuell halten — sie ist der Einstiegspunkt für jeden neuen Kontext.*
