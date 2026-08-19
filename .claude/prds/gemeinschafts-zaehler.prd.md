# Gemeinschafts-Zähler auf der Discovery-Page

## Problem
Nutzer öffnen die App überwiegend zu den Ritual-Zeiten (21:00) und haben tagsüber wenig Grund zurückzukehren. Es fehlt ein spürbares Signal, dass „die ganze Stadt" gerade gemeinsam an etwas arbeitet. Ohne dieses Zusammengehörigkeits-Gefühl bleibt Corso eine Sammlung einzelner Momente statt eines geteilten Stadt-Rituals — und der tägliche Loop verliert Zugkraft.

## Evidence
- Annahme (Pilot-Hypothese) — noch nicht belegt. Zu validieren via Freundes-Pilot (Beobachtung von Öffnungshäufigkeit) und späterer Analytics.
- Konzeptioneller Beleg aus PRD: Corso ist bewusst als geteiltes, stadtweites Ritual angelegt („deine Stadt geht gemeinsam spazieren"); ein sichtbarer Gemeinschafts-Zähler ist eine direkte Verstärkung dieses Kern-Gefühls.

## Users
- **Primär**: Pilot-Mitglied in Düsseldorf (Freundes-Pilot, 20–30 Personen), das die App tagsüber öffnet und einen niedrigschwelligen Grund braucht, mehrfach zurückzukehren und sich als Teil der Stadt-Bewegung zu fühlen.
- **Nicht für**: Nutzer, die harte Ziele, Gamification oder Wettbewerb suchen — der Zähler ist ausdrücklich keine Challenge und liefert keine personenbezogenen Zahlen.

## Hypothesis
Wir glauben, dass **ein dezenter, wachsender Stadt-Zähler oben auf der Discovery** das **fehlende Zusammengehörigkeits-Gefühl und den fehlenden Tagsüber-Anreiz** für **Düsseldorfer Pilot-Mitglieder** löst.
Wir wissen, dass wir richtig liegen, wenn **die Post-Rate der Stadt (geposteten Momente pro Tag) im Pilot spürbar steigt**, weil Leute den Zähler wachsen sehen und selbst dazu beitragen wollen.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Post-Rate der Stadt (Momente/Tag) | Anstieg ggü. Baseline vor Einführung | TBD — Vergleich Tages-Postzahlen aus der DB, Baseline noch zu erheben |
| Sekundär: Discovery-Öffnungen/Nutzer/Tag | Anstieg (qualitativ im Pilot) | TBD — Beobachtung / spätere Analytics |

## Scope
**MVP** — Ein dezenter, aggregierter Zähler oben auf der Discovery-Page:
- Zeigt „X Momente heute in Düsseldorf" (heute) und darunter kleiner „gestern: Y".
- „Heute" = Kalendertag seit 00:00 in **Europe/Berlin**. „Gestern" = kompletter Vortag 00:00–23:59 Europe/Berlin.
- Bewusst **entkoppelt vom 24h-Verfall** einzelner Posts — reines Stimmungsbild, keine exakte Abbildung des sichtbaren Feeds.
- Zählt **nur Stadt-Story-freigegebene Momente** (Consent-konsistent). → Diskrepanz zur sichtbaren Feed-Menge und zur ursprünglichen Formulierung „alle Momente" ist bewusst in Kauf genommen.
- **Stadt = Düsseldorf, hartkodiert** (ein Stadtraum im Pilot), kein Pro-Stadt-Filter.
- Aktualisiert beim Öffnen/Refresh der Discovery.
- Nur eine aggregierte Zahl: keine Namen, keine Ränge, keine Info wer wie viel gepostet hat.
- Echte Zahlen, keine gefakten/aufgehübschten Werte.

**Out of scope**
- Ziel, Schwelle, Fortschrittsbalken, Konsequenz bei niedriger Zahl — ausdrücklich keine Challenge.
- Personenbezogene Zahlen, Rangliste, „wer hat gepostet".
- Live-/Realtime-Updates ohne Refresh — MVP aktualisiert beim Öffnen/Refresh.
- Pro-Stadt-Filterung / Mehrstadt-Fähigkeit — erst wenn eine zweite Stadt real wird.
- Verknüpfung mit der individuellen Reichweite/Feedback-Kennzahl des Nutzers.

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Stadt-Aggregat verfügbar | Ein serverseitig ermittelter, argumentloser Tages-/Vortags-Wert der Stadt-Story-freigegebenen Momente in Europe/Berlin ist abrufbar | pending | — |
| 2 | Dezenter Zähler auf Discovery | Nutzer sieht oben auf der Discovery „X heute / gestern: Y", ohne dass der Feed verdrängt wird | pending | — |

## Open Questions
- [ ] Baseline für die Post-Rate: gibt es genug Pilot-Historie, um „Anstieg" zu messen, oder muss vor Einführung erst gemessen werden?
- [ ] Zeitzonen-Randfall: „heute" per Europe/Berlin steht bewusst im Kontrast zum 21:00-Corso-Tag (`corso-day.ts`). Bestätigt, dass hier der Kalendertag (00:00) gilt und NICHT der Corso-Zyklus — beide Zeitbegriffe existieren dann parallel.
- [ ] Leerzustand: Wie wird „0 Momente heute" früh am Tag dargestellt, damit es nicht entmutigend wirkt (Zähler soll keine Konsequenz bei niedriger Zahl haben)?
- [ ] Singular/Plural und Text bei „gestern: 0" bzw. fehlendem Vortag (erster Betriebstag).

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Niedrige Zahl wirkt entmutigend statt verbindend (v.a. Pilot mit wenig Volumen) | Mittel | Mittel | Bewusst dezent, kein Ziel/kein Balken; Leerzustand-Text neutral halten; Vortagsvergleich einordnend statt wertend |
| Diskrepanz „X heute" vs. sichtbarer Feed verwirrt (Entkopplung vom Verfall + nur Consent-Momente) | Mittel | Niedrig | Als reines „Stimmungsbild der Stadt" framen; keine Behauptung, es sei der Feed-Umfang |
| Zeitzonen-Fehler (UTC statt Europe/Berlin) verschiebt Tagesgrenze | Niedrig | Mittel | Aggregation serverseitig explizit in Europe/Berlin; Testfall um Mitternacht |
| Zähler wird als Challenge/Vanity-Metric gelesen und erzeugt Druck | Niedrig | Mittel | Keine Schwelle/kein Fortschritt; nur aggregiert, nie personenbezogen |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
