# CLAUDE.md

## Was wird hier gebaut

<!-- TODO: Beschreibe die App in 2-3 Sätzen. Was ist der Zweck, wer sind die Nutzer? -->
PLATZHALTER – App-Beschreibung hier einfügen.

## Stack

<!-- TODO: Fülle aus sobald der Stack feststeht. Beispiel:
- Frontend: Next.js 14, TailwindCSS
- Backend: Node.js, Express
- Datenbank: PostgreSQL, Prisma
- Auth: Clerk / NextAuth
- Hosting: Vercel
-->
PLATZHALTER – Stack noch nicht definiert.

## Dateistruktur

<!-- TODO: Aktualisiere diese Struktur wenn das Projekt wächst. -->
```
CORSO_EPHY/
├── CLAUDE.md
├── .gitignore
├── .cursor/
│   └── rules/
│       ├── general.mdc
│       ├── architecture.mdc
│       └── stack.mdc
└── .claude/
    ├── settings.json
    └── roles/
        ├── builder.md
        ├── tester.md
        ├── ui.md
        └── reviewer.md
```

## Konventionen

- Sprache im Code: Englisch (Variablen, Funktionen, Kommentare)
- Sprache in Antworten und Dokumentation: Deutsch
- Commits: konventionelle Commits (`feat:`, `fix:`, `chore:` etc.)
- Keine Magic Numbers – Konstanten mit sprechenden Namen
- Keine auskommentierten Code-Blöcke im finalen Code
- Funktionen klein halten – eine Aufgabe pro Funktion
- Typen explizit deklarieren (kein implizites `any` bei TypeScript)

## Was du NICHT tun sollst

- Kein automatisches `git commit` oder `git push`
- Kein automatisches Deployment
- Keine Abhängigkeiten installieren ohne Rückfrage
- Keine Dateien außerhalb des Projektverzeichnisses verändern
- Keine `.env`-Datei anlegen oder befüllen ohne explizite Anweisung
- Keine Dummy-Daten in Produktion schreiben
- Keine Entscheidungen über Architektur oder Stack ohne Absprache
