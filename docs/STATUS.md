# Corso — Status

**Stand:** 18. Juni 2026
**Zweck:** Lebender Schnappschuss. Wer neu in das Projekt einsteigt (Mensch oder Agent), liest das hier zuerst und weiß, wo es steht und was der nächste konkrete Schritt ist. Diese Datei bei jedem nennenswerten Fortschritt aktualisieren.

> Reihenfolge zum Reinkommen: `CLAUDE.md` → `docs/PRD.md` (was & warum) → `docs/ROADMAP.md` (was als nächstes) → **diese Datei** (wo genau stehen wir).

---

## Wo wir stehen

**Phase:** Beginn **Phase 0 — Backend-Fundament** (siehe `docs/ROADMAP.md`).
**Insgesamt:** Klickbarer Frontend-Prototyp ohne Backend. Alle Daten kommen aus Mock-Konstanten, Follow-State lebt nur im React-Context und stirbt beim Reload.

### Existierende Screens (Routes in `src/routes/`)
| Route | Screen | Stand |
|---|---|---|
| `index.tsx` | Discovery (Entdeckungs-Feed, vertikaler Swipe) | UI steht, Mock-Daten |
| `story.tsx` | Stadt-Story (20:00-Ritual) | UI steht, 8 Mock-Clips, Swipe vertikal + Karten-Optik wie Discovery (PRD §5 nachgezogen) |
| `record.tsx` | Aufnahme (echte Live-Kamera) | Kamera live; „Verwenden"-Upload noch disabled (kein Backend) |
| `connections.tsx` | Verbindungen / verdienter Chat | Platzhalter |
| `feedback.tsx` | Rücklauf (private Reichweite) | Platzhalter, Zahlen noch mock |

### Noch nicht vorhanden
Gesamtes Backend · echter Video-Upload/Storage · Auth/Onboarding · echte Rücklauf-Daten · Metrik-/Event-Tracking · Stadt-Story-Algorithmus · Push.

---

## Aktuell in Arbeit (uncommitted)

Auf Branch `main` liegen ungetestete/uncommittete Änderungen:
- `src/hooks/use-camera.ts` — **neu**, `getUserMedia`-Hook (Live-Kamera-Pflicht, `MAX_RECORD_MS = 15s`, Front/Back-Kamera).
- `src/routes/record.tsx` — Aufnahme-Screen auf den Kamera-Hook umgebaut.
- `src/routes/story.tsx`, `src/routes/index.tsx` — Story-UX an Discovery angeglichen (vertikaler Karten-Feed).
- `src/components/follow-button.tsx`, `src/components/heart-burst.tsx` — **neu**, geteilte Folgen-Button- und Herz-Burst-Bausteine (vorher in jedem Feed dupliziert).
- `vite.config.ts` — Build-/Dev-Anpassung.

**Follow-Flow konsistent gemacht (Discovery → „Ich folge"):**
- `src/lib/follow-context.tsx` — Follow-State **persistiert jetzt in localStorage** (`corso.followed.v1`), überlebt Reload auf demselben Gerät. SSR-sicher (deterministischer Start, Laden erst nach Mount). ⚠️ **Kein geteilter Server** — zwei Handys sehen weiter NICHT denselben Stand. Das echte Backend (Phase 0) bleibt offen und braucht die Stack-Entscheidung mit dem Eigner.
- `src/routes/index.tsx` — Discovery reagiert reaktiv auf den Follow-State statt auf ein am Mount eingefrorenes Set. Wem du folgst, **gleitet nach kurzer Herz-Animation aus Discovery** und lebt nur noch unter „Ich folge" (PRD §4.4). Behebt die alte Inkonsistenz „bleibt diese Session sichtbar, weg nach Navigation".

> Vor neuem Feature-Bau: diese WIP-Änderungen sichten und committen (nur nach Rückfrage, siehe CLAUDE.md).

---

## Nächster konkreter Schritt

**Phase 0 — Backend-Fundament mit Supabase.** Stand der Bausteine:
1. ✅ **Backend-Stack entschieden: Supabase** (Auth + Postgres + Storage + pg_cron).
2. ✅ **Datenmodell** als Migration: `supabase/migrations/0001_init.sql` (profiles, prompts, posts, follows, nudges, city_story_slots, reach_snapshots) inkl. RLS + `corso_day()`-Helper + `my_reach()` (private Publikumsgröße ohne Identitäten). `.env.example` auf Supabase umgestellt.
3. ✅ **Projekt CORSO angelegt** (ref `uuhrylkvwosflyypbdbj`), `.env` mit URL + anon + service_role gesetzt. ⚠️ service_role wurde im Chat geteilt → **rotieren** (Settings → API → Roll), danach `.env` updaten.
4. ✅ **`@supabase/supabase-js` installiert** (via npm — `bun` nicht im PATH; `bun install` nachziehen für Lockfile-Sync) + Client-Gerüst: `src/lib/supabase/client.ts` (Browser, anon, RLS), `server.ts` (service_role, nur Server), `types.ts` (DB-Typen). Typecheck grün.
5. ✅ **Supabase live eingerichtet** (via Management API): Migration eingespielt (verifiziert: 7 Tabellen, `corso_day`/`my_reach`, RLS auf allen, 16 Policies), Bucket `moments` (private) angelegt, Auth Site-URL + Redirect `http://localhost:3000` gesetzt, Email/Magic-Link aktiv. ⚠️ PAT zum Widerrufen offen; service_role rotieren.
6. ✅ **Auth (Magic-Link) gebaut:** `src/lib/auth-context.tsx` (Session + Profil + Magic-Link), `src/components/auth-gate.tsx` (Splash → Login → Handle-Wahl → App), eingehängt in `__root.tsx`. SSR-sicher (Splash serverseitig, Session-Check nach Mount), Typecheck + Dev-Boot ohne Fehler verifiziert. ⏳ **Noch zu testen:** echter Login-Klick im Browser (E-Mail → Magic-Link → Handle → App).
   - ⚠️ **BLOCKER (offen): Login über ngrok funktioniert noch nicht.** Vite lässt den Tunnel zwar durch (`allowedHosts` in `vite.config.ts`), aber der Magic-Link-Login schlägt fehl. Vermutete Ursache: Supabase **Auth Site-URL + Redirect stehen auf `http://localhost:3000`** — der Link aus der E-Mail zeigt damit auf dem Handy ins Leere statt auf die ngrok-URL. **Nächster Schritt:** in Supabase (Auth → URL Configuration) die aktuelle ngrok-URL als Site-URL/Redirect zulassen (oder `emailRedirectTo` dynamisch auf `window.location.origin` setzen), dann erneut vom Handy testen.
7. ⏳ Storage-RLS-Policies für `moments` (Upload/Read je eigene Objekte) → `0002_storage.sql`.
8. ⏳ Video-Upload in Bucket `moments` (macht „Verwenden"-Button funktional).
9. ⏳ 08:00-Reset als pg_cron-Job (Follow-Verfall, Discovery leeren, neuer Prompt).
10. ⏳ Follow-Logik aus `src/lib/follow-context.tsx` ins Backend migrieren (Vertrag: `followFill`/`lastReset`/`canRenew` bleiben erhalten).

Akzeptanzkriterien für Phase 0 → `docs/ROADMAP.md`.

---

## Bekannte offene Entscheidungen, die jetzt relevant sind

- **Auth-Methode:** Magic-Link (E-Mail) vs. Telefon-OTP. Default-Empfehlung für den Freundes-Pilot: **Magic-Link** (kein SMS-Provider/Kosten). Noch zu bestätigen.
- Stadt-Story-Größe/Frequenz bei kleinem Pilot (PRD #6) → blockt erst Phase 1.
- Verbindungs-Trigger bei verfallenden Follows (PRD #8) → blockt erst Phase 3.

---

*Diese Datei aktuell halten — sie ist der Einstiegspunkt für jeden neuen Kontext.*
