# Corso

**Lokale Stadtbeobachtungs-App mit Dating-Ausgang.**

Jeden Abend geht deine Stadt gemeinsam spazieren: rohe, ungeschnittene Video-Momente echter Menschen aus deiner Umgebung. Um 20:00 Uhr kann jeder Nutzer zufällig ins stadtweite Rampenlicht gezogen werden. Wer dort gefällt, gewinnt Publikum — aber dieses Publikum verfällt täglich um 08:00 Uhr, wenn man nicht nachliefert.

> Dating ist der Ausgang, nicht der Eingang.

**Pilot:** Düsseldorf · PWA · zuerst gratis Freundes-Pilot, danach zahlender Fremden-Pilot (€9/Monat)

---

## Setup

```bash
git clone git@github.com:subworx-io/CORSOEPHY.git
cd CORSOEPHY

bun install

cp .env.example .env
# .env mit echten Werten befüllen

bun run dev
```

## Verfügbare Scripts

```bash
bun run dev        # Entwicklungsserver
bun run build      # Production Build
bun run preview    # Build lokal vorschauen
bun run lint       # ESLint
bun run format     # Prettier
```

## Stack

- **Framework:** TanStack Start + React 19
- **Build:** Vite + Bun
- **UI:** shadcn/ui + Radix UI + Tailwind CSS v4
- **Routing:** TanStack Router (file-based)
- **Data:** TanStack Query

Details → `.cursor/rules/stack.mdc`

## Screens

| Route | Screen |
|---|---|
| `/` | Discovery — vertikaler Swipe durch Stadtmomente |
| `/story` | Stadt-Story — 20:00 Ritual, vertikaler Swipe (UX wie Discovery) |
| `/record` | Aufnahme — Live-Kamera + Tages-Prompt |
| `/connections` | Korso — Verbindungen + verdienter Chat |
| `/feedback` | Rücklauf — morgendliche Reichweite (privat) |

## Dokumentation

Lese-Reihenfolge zum Reinkommen:

1. `CLAUDE.md` — Konventionen und Leitplanken für AI-Assistenten (Einstieg)
2. `docs/PRD.md` — Product Requirements, Kern-Mechaniken, Pilot-Spezifikation (Source of Truth)
3. `docs/ROADMAP.md` — Bau-Reihenfolge nach Abhängigkeit (Phasen 0–3)
4. `docs/STATUS.md` — aktueller Stand + nächster konkreter Schritt
- `.cursor/rules/` — Cursor IDE Regeln

## Kontakt

Dominik — tools@subworx.io
