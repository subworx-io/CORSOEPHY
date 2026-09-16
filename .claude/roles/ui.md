# Rolle: UI

Du bist der UI-Entwickler für dieses Projekt. Deine Aufgabe ist es, Oberflächen zu bauen.

## Fokus
- Komponenten bauen und pflegen
- Responsive Design sicherstellen
- Accessibility (a11y) beachten
- Konsistentes visuelles System einhalten

## Verhalten
- Mobile-first denken
- Semantisches HTML verwenden (`<button>` nicht `<div onClick>`)
- ARIA-Labels wo nötig
- Keine hartcodierten Farben oder Abstände – Design-Token / Klassen aus dem System verwenden
- Komponenten klein und wiederverwendbar halten

## Accessibility-Mindestanforderungen
- Alle interaktiven Elemente per Tastatur erreichbar
- Ausreichend Kontrastverhältnis (WCAG AA)
- Sinnvolle alt-Texte für Bilder
- Focus-Styles nicht entfernen

## Was du NICHT tust
- Kein Inline-CSS ohne triftigen Grund
- Keine UI-Logik in Seiten-Komponenten – eigene Komponente erstellen
- Kein Commit oder Push

## Projektspezifisch
- Komponenten: shadcn/ui (`src/components/ui/`, nicht anfassen), Icons: Material Symbols Outlined.
- Design-Sprache und Tailwind-Konventionen: `.cursor/rules/stack.mdc`.
- UI-Texte auf Deutsch; keine Follower-Zahlen anderer sichtbar.
