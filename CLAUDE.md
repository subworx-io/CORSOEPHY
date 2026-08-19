# CLAUDE.md

## Was wird hier gebaut

**Corso** ist eine lokale Stadtbeobachtungs-App mit Dating-Ausgang.
Jeden Abend "geht deine Stadt gemeinsam spazieren": rohe, ungeschnittene Video-Momente echter Menschen aus der Umgebung. Um 21:00 Uhr kann jeder Nutzer zufällig ins stadtweite Rampenlicht gezogen werden — zeitgleich startet der neue Prompt. Publikum verfällt 24 Stunden nach dem Follow, wenn man nicht nachliefert.

**Pilot:** Düsseldorf, **PWA** (kein Telegram, keine native App). Zwei Schritte: zuerst gratis Freundes-Pilot (20–30 Freunde, misst ob der Loop zieht), danach zahlender Fremden-Pilot (60–100 Mitglieder, €9/Monat, 4–6 Wochen).
**Eigner:** Maxim.

## Start hier (Lese-Reihenfolge für jeden neuen Kontext)

Vor dem Arbeiten der Reihe nach lesen — die Docs sind die Source of Truth, nicht dieses Gedächtnis:

1. **`CLAUDE.md`** (diese Datei) — Konventionen, Leitplanken, Stack.
2. **`docs/PRD.md`** — was & warum. Produkt-Source-of-Truth. Bei jedem Konflikt gewinnt das PRD.
3. **`docs/ROADMAP.md`** — was als nächstes & in welcher Reihenfolge (nach Abhängigkeit, Phase 0 blockt alles).
4. **`docs/STATUS.md`** — wo genau stehen wir gerade, was ist WIP, nächster konkreter Schritt. **Bei jedem nennenswerten Fortschritt aktualisieren.**

Regel: keine `[ENTSCHEIDUNG OFFEN]` stillschweigend treffen, keine 🔒 LEITPLANKE umgehen — eskalieren.

## Setup & Befehle

```bash
bun install                  # Abhängigkeiten
cp .env.example .env         # .env mit echten Werten befüllen (siehe .env.example)
bun run dev                  # Dev-Server (http://localhost:3000)
bun run dev:mobile           # Dev-Server + ngrok für iPhone-/Kamera-Tests (HTTPS)
bun run build                # Production Build
bun run preview              # Build lokal vorschauen
bun run lint                 # ESLint
bun run format               # Prettier (semi: true, double quotes, printWidth 100)
node scripts/db-apply.mjs    # Supabase-Migrationen aus supabase/migrations/ anwenden
bash scripts/deploy.sh       # Deploy nach Cloudflare Pages (nur auf Ansage)
```

- **Live-Kamera braucht HTTPS** — auf dem Handy nur über `dev:mobile` (ngrok) testbar, nicht über `http://<lan-ip>`.
- Kein Unit-/E2E-Framework konfiguriert. Vorhanden sind Security-Smoke-Tests: `scripts/security-test-*.mjs`.

### Kern-Mechaniken (nicht verhandelbar)
- 🔒 Live-Kamera-Pflicht — kein Galerie-Upload, keine Filter
- 🔒 Follower-Zahlen sind für andere unsichtbar
- 🔒 Kein Publikums-Verfall durch Zahlung verlängerbar
- 🔒 Einwilligung pro Moment, ob für den Stadt Corso freigegeben
- Verfallendes Publikum: Follow = 24h **ab dem Follow** (individuelle Uhr pro Datensatz, kein stadtweiter Reset), danach aktiver Re-Entscheid; Erneuern ab 12h möglich
- Moment = 24h ab dem Upload, danach überall weg; genau ein lebender Moment pro Person
- Verdienter Chat: erst nach 3–4 gegenseitigen Moment-Austauschen

## Stack

- **Framework:** TanStack Start + React 19
- **Build:** Vite + Bun
- **Routing:** TanStack Router (file-based, `src/routes/`)
- **Data fetching:** TanStack Query
- **UI:** shadcn/ui + Radix UI + Tailwind CSS v4
- **Forms:** React Hook Form + Zod
- **Icons:** Material Symbols Outlined (Google Fonts)
- **Charts:** Recharts
- **Sprache:** TypeScript (strict)
- **Package manager:** Bun
- **Backend:** **Supabase** — Auth (Magic-Link), Postgres mit RLS, Storage (Bucket `moments`), pg_cron für die Zeit-Rituale. Migrationen liegen als nummerierte SQL-Dateien in `supabase/migrations/`.
- **Deployment:** **Cloudflare Pages** (Worker-SSR), live auf `https://corso-app.pages.dev`. Einziger Befehl: `bash scripts/deploy.sh`.

### Wichtige Backend-Prinzipien
- **Leitplanken werden serverseitig erzwungen, nicht im Client.** Der Einwilligung für den Stadt Corso-Filter, die Follower-Privatsphäre und der 24h-Verfall leben in SQL-Funktionen, Triggern und RLS-Policies. Eine UI-seitige „Lösung" für eine 🔒 Leitplanke ist keine.
- **Kennzahl-Funktionen sind argumentlos.** `my_reach()` / `my_feedback()` sind `SECURITY DEFINER` ohne Parameter — es gibt bewusst keinen Weg, die Zahl eines *anderen* Users abzufragen. Nicht „für Debugging" einen Parameter ergänzen.
- **Der service_role-Key gehört nicht in den Client und nach Möglichkeit nicht in den Edge.** Der Tages-Prompt lief ursprünglich über eine Server-Action und wurde bewusst auf Client-RPC umgestellt, um den Key aus dem Worker zu halten. Nur das Einlösen von Einladungs-Links braucht ihn noch.

## Dateistruktur

```
CORSO_EPHY/
├── docs/
│   ├── PRD.md                # Product Requirements (Source of Truth — was & warum)
│   ├── ROADMAP.md            # Bau-Reihenfolge nach Abhängigkeit (Phasen 0–3)
│   └── STATUS.md             # Lebender Schnappschuss: aktueller Stand + nächster Schritt
├── src/
│   ├── routes/               # file-based routing — Konventionen: src/routes/README.md
│   │   ├── __root.tsx        # Root-Layout, BottomNav, QueryClientProvider, AuthGate, Prompt-Splash
│   │   ├── index.tsx         # Discovery-Screen (Entdeckungs-Feed, Swipe vertikal)
│   │   ├── record.tsx        # Aufnahme-Screen (Live-Kamera + Prompt)
│   │   ├── story.tsx         # Stadt Corso (21:00 Ritual, Swipe vertikal — UX/Optik wie Discovery, PRD §4.6)
│   │   ├── connections.tsx   # „Ich folge" + verdienter Chat (Chat = Phase 3, noch nicht gebaut)
│   │   ├── feedback.tsx      # Rücklauf (morgendliche Reichweite, privat)
│   │   ├── settings.tsx      # Einstellungen (Screen 10, bewusst minimal)
│   │   ├── impressum|datenschutz|agb.tsx   # Rechts-Platzhalter (Gerüst: components/legal-page.tsx)
│   │   └── story-empty-lab.tsx             # Lovable-Sandbox für den Leerzustand des Stadt Corso (Mock, kein Supabase)
│   ├── components/
│   │   ├── auth-gate.tsx     # Login-Screen + Session-Gate
│   │   ├── city-backdrop.tsx # Geblurrte s/w Düsseldorf-Clips (Leerzustand des Stadt Corso + Prompt-Splash)
│   │   ├── daily-prompt-splash.tsx  # Vollbild-Prompt, 1× pro Corso-Tag
│   │   ├── dev-menu.tsx      # Admin-Dev-Menü, NUR für dominik@subworx.io (serverseitig geprüft)
│   │   ├── follow-button.tsx, heart-burst.tsx, legal-page.tsx
│   │   └── ui/               # shadcn/ui Komponenten (nicht anfassen)
│   ├── hooks/
│   │   ├── use-camera.ts     # 🔒 getUserMedia + MediaRecorder — die Live-Kamera-Pflicht
│   │   ├── use-snap-scroll.ts# Vertikaler Snap-Feed (Discovery/Stadt Corso/Ich-folge teilen ihn)
│   │   └── use-mobile.tsx
│   ├── lib/
│   │   ├── auth-context.tsx  # Session + Profil (Vorsicht: Auth-Lock, siehe STATUS)
│   │   ├── follow-context.tsx# Follow/Renew/Unfollow/Nudge — alle DB-Writes zentral hier
│   │   ├── corso-day.ts      # Der 21:00-Zyklusschnitt — überall benutzen, nie neu berechnen
│   │   ├── record-view.ts    # Anonyme Ansichten-Erfassung (500-ms-Verweil-Schwelle)
│   │   ├── prompts/          # useTodayPrompt → RPC get_today_prompt()
│   │   ├── invites/          # ⚠️ Pilot-Provisorium: E-Mail-freie Einladungs-Links
│   │   ├── supabase/         # client.ts, upload.ts, types.ts (handgepflegt!)
│   │   └── utils.ts
│   ├── assets/               # .asset.json Lovable-Assets
│   ├── styles.css            # Globale Tailwind-Styles
│   ├── router.tsx            # Router-Setup
│   ├── server.ts             # Server Entry Point (fängt /invite/<token> ab)
│   ├── start.ts              # App Entry Point
│   └── routeTree.gen.ts      # auto-generiert — nie von Hand editieren
├── supabase/
│   ├── migrations/           # Nummerierte SQL-Migrationen (0001…) — Reihenfolge ist bindend
│   ├── seed/                 # Prompt-Seeds
│   └── templates/            # Auth-E-Mail-Template (auth_email_de.html)
├── scripts/
│   ├── deploy.sh             # Der einzige Deploy-Befehl
│   ├── db-apply.mjs          # Migration anwenden (braucht SBP-Token)
│   ├── make-invites.mjs      # Einladungs-Links erzeugen (lokal, service_role)
│   └── security-test-*.mjs   # Negativ-Tests für die Privatsphäre-Leitplanken
├── public/                   # inkl. empty-bg-4…9.mp4 (~35 MB Hintergrund-Clips, in Git)
├── .claude/                  # Claude Code Konfiguration
├── .cursor/rules/            # Cursor IDE Regeln
└── ...config files
```

## Konventionen

- **Sprache im Code:** Englisch (Variablen, Funktionen, Typen)
- **Sprache UI-Text:** Deutsch (alle sichtbaren Texte sind auf Deutsch)
- **Sprache Antworten:** Deutsch
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:` etc.)
- Neue Routen → immer als Datei in `src/routes/` (TanStack file-based routing)
- Neue UI-Komponenten → zuerst prüfen ob shadcn/ui-Komponente vorhanden
- Keine hartcodierten Farben — Tailwind-Klassen oder CSS-Variablen
- Keine Follower-Zahlen oder Publikumsgröße für andere Nutzer sichtbar machen
- **Migrationen sind append-only:** neue Datei mit der nächsten Nummer, bereits angewendete Migrationen nie rückwirkend editieren
- **`src/lib/supabase/types.ts` ist handgepflegt** (nicht generiert) — bei jeder Schema-Änderung mitziehen, sonst driftet es unbemerkt
- **Zeitlogik immer über `corso-day.ts`** — der Zyklus beginnt um 21:00, nicht um Mitternacht. Nie eigenes Datums-Rechnen daneben bauen.
- **Verfall immer über `expires_at > now()` filtern**, nie über Tages-Arithmetik. `expires_at` wird ausschließlich per DB-Trigger gesetzt — nie vom Client mitschicken.

## Was du NICHT tun sollst

- `git commit` und `git push` nur nach ausdrücklicher Rückfrage — niemals ungefragt
- Kein Deployment
- Keine neuen npm/bun-Abhängigkeiten ohne Rückfrage
- Keine Architektur-Entscheidungen ohne Absprache
- Keine `.env`-Datei anlegen oder befüllen ohne explizite Anweisung
- Keine der 🔒 LEITPLANKEN aus dem PRD umgehen oder weichspülen
- Keine Dummy-Daten in produktive Endpoints schreiben
- Kein Galerie-Upload implementieren (egal wie klein der Scope klingt)
