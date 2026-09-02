# Corso — Product Requirements Document

**Version:** 0.5 (Stand 2. September 2026)
**Status:** Pre-Pilot. Konzept final, Pilot als gratis Freundes-Pilot auf PWA spezifiziert. Der Freundes-Pilot ist **noch nicht gestartet** — es gibt bislang keine Signale zu den Kill-Metriken (§9).
**Eigner:** Maxim

> Single Source of Truth für Menschen und AI-Agents, die Corso aufbauen.
> Offene Entscheidungen sind als `[ENTSCHEIDUNG OFFEN]` markiert und dürfen nicht stillschweigend getroffen werden.
> Kritische Leitplanken sind mit 🔒 LEITPLANKE markiert — nicht verhandelbar ohne Freigabe des Eigners.
> Die priorisierte Bau-Reihenfolge steht in `docs/ROADMAP.md`, der tagesaktuelle Stand in `docs/STATUS.md`. Bei Konflikt gewinnt dieses PRD.

> **Changelog v0.4 → v0.5** (Zwei-Achsen-Umbau, Entscheidung Dominik 2. Sep 2026, als Eigner-Freigabe bestätigt):
> - **Zwei-Achsen-Modell:** Achse 1 „Die Stadt" (Broadcast, Fremde: Discovery + „Ich folge" unter EINEM Menüpunkt mit Toggle) und Achse 2 **„Circle"** (beständig, gegenseitig, eigener Menüpunkt). §4.4 und §4.8 entsprechend neu.
> - **„Ich folge" zeigt nur noch Menschen mit lebendem Moment** — die Verbindung bleibt, die Sichtbarkeit hängt am Moment (kein Karteileichen-Feed). Ersetzt die frühere Regel „zeigt auch Leute ohne Moment".
> - **Anstupsen (§4.5) GEPARKT:** mit der neuen Sichtbarkeitsregel hat es keinen Ort mehr; UI entfernt, Backend bleibt.
> - **Verdienter Chat entschieden:** Chat lebt ausschließlich im Circle und wird mit dem Circle-Eintritt frei (löst die offenen Entscheidungen #2/#8 ab — die 3–4-Austausch-Regel ist damit ersetzt).
> - **Fotos gebaut:** Foto-Momente (bis 5 Fotos als Stapel = EIN Moment), weiterhin 🔒 nur Live-Kamera. Aufnahme: Tippen = Foto, Halten = Video.
> - **Bottom-Nav:** Stadt · Corso · Kamera · Circle · Du (5 Items; das Ritual-Tab hieß kurz „Story", seit dem Abend-Feinschliff „Corso"). „Du" = bisheriger Rücklauf/Self-Screen.
>
> **Changelog v0.3 → v0.4** (nur Status-Korrekturen, keine Konzept-Änderung):
> - Offene Entscheidung **#6 (Größe des Stadt Corso) auf ENTSCHIEDEN gesetzt** — die Entscheidung fiel am 15. Juli, das PRD hing hinterher. §4.6 entsprechend präzisiert: max. 8 Momente, kein Mindest-Schwellwert, kein Fake-Auffüllen.
> - Offene Entscheidung **#7 (Privater Corso)** mit dem Hinweis versehen, dass sie mit dem Push-Feature in Roadmap-Phase 1 fällig wird.
>
> **Changelog v0.2 → v0.3** (eingearbeitet aus Roadmap v0.1):
> - Pilot-Tooling **Telegram → PWA** (Grundsatzentscheidung G1). Die Live-Kamera-Pflicht ist in der PWA nativ umsetzbar und bereits implementiert.
> - Pilot-Modell **zahlend → gratis Freundes-Pilot** als erster Schritt (G2); zahlender Fremden-Pilot bleibt späterer zweiter Schritt.
> - Damit erledigt: das frühere Telegram-Live-Kamera-Spannungsfeld und offene Entscheidung #9.

---

## 1. Die Eine Idee

Corso ist eine **lokale Stadtbeobachtungs-App mit Dating-Ausgang**. Jeden Tag gibt es einen gemeinsamen Prompt — jeder postet seinen Moment, die Stadt scrollt, folgt, vergisst oder erinnert sich. Um 21:00 Uhr sieht die ganze Stadt dieselben acht ausgewählten Momente, und der neue Prompt startet. Wer dort gefällt, gewinnt **Publikum** — aber jeder Follow **verfällt 24 Stunden nach dem Follow**, wenn man nicht nachliefert.

### Zentrale emotionale Mechanik
- **Stadt Corso = Aufstieg.** Random, plötzlich, vor der ganzen Stadt.
- **Verfallendes Publikum = Schwerkraft.** Wer nicht nachliefert, sinkt.

Zusammen: ständige Bewegung statt statischer Hierarchie.

---

## 2. Value Proposition

**Konsument (primär):** "Jeden Abend sehe ich, wie meine Stadt wirklich lebt."
**Produzent (sekundär):** "Heute Abend könnte die ganze Stadt mich sehen."

Dating ist der **Ausgang**, nicht der Eingang. Diese Reihenfolge prägt jede Entscheidung.

### Drei Differenzierer
1. Verfallendes Publikum als Produktions-Engine.
2. Verdienter Chat (Belohnung statt Startpunkt).
3. Stadt Corso als kollektives Ritual.

---

## 3. Zielgruppe & Markt

- **ICP:** 20–32, dicht besiedelte Stadt, Dating-App-müde.
- **Pilot-Stadt:** Düsseldorf (Gründer vor Ort, hohe Bevölkerungsdichte, starke Ausgehkultur).
- **Kritische Masse:** `[ANNAHME]` ~800–1.000 Aktive/Stadt.

---

## 4. Kern-Mechaniken

### 4.1 Der "Moment"
- Foto oder vertikales Video. Ein Foto-Moment kann aus **bis zu 5 live aufgenommenen Fotos** bestehen (im Feed als Stapel gezeigt). Aufnahme: **Tippen = Foto, Halten = Video** (ein Auslöser, kein Modus-Umschalter).
- 🔒 **LEITPLANKE: Live-Kamera-Pflicht, kein Galerie-Upload.** Gilt für Foto wie Video (Fotos entstehen ausschließlich als Frame aus dem Live-Stream).
- Mehrere Takes, **kein Schnitt, keine Filter, keine Beauty.**
- Täglicher Prompt ist leicht, konkret und filmbar — LeiCharakter statt Tiefe, nie Hausaufgabe/Therapie. ≥50 % gesichts-optional.
- **Lebensdauer eines Moments: genau 24 h ab dem Upload.** Jeder Moment trägt seine eigene Uhr (`posts.expires_at = created_at + 24 h`), es gibt keinen stadtweiten Reset mehr. Danach ist er überall weg — auch für den Autor.
- **Genau ein lebender Moment pro Person.** Ein neuer Moment beendet den vorherigen sofort.

### 4.2 Der tägliche Prompt
- Jeden Tag um **21:00 Uhr** erscheint ein neuer Prompt, stadtweit identisch und für den ganzen Corso-Zyklus (21:00 → 21:00) eingefroren.
- Gleichzeitig mit der Ziehung für den Stadt Corso: die Stadt sieht den Corso des vergangenen Zyklus und bekommt im selben Moment die neue Aufgabe.
- Jeder kann darauf mit einem Foto oder Video antworten.
- Momente sind unmittelbar nach dem Upload in der Discovery sichtbar.
- **Ton (Anti-Test):** „Würde ich das entspannt an einem normalen Dienstagabend vor 500 Fremden aus meiner Stadt zeigen, ohne lange zu überlegen?" Wenn nein → zu heavy. Passeggiata statt Beichte.
- **Drei Hebel (Kategorien) mit Rotations-Gewichtung ~40 / 40 / 20:**
  - `zeig` — die Antwort liegt in der Welt, nicht im Kopf („Zeig, wo du gerade sitzt.")
  - `augenzwinkern` — frech, selbstironisch, lebensfroh („Beweise, dass du gerade nichts Produktives tust.")
  - `funken` — ein bisschen Persönlichkeit, ohne Tiefe zu erzwingen („Dein Guilty Pleasure, zu dem du stehst.")
- **Auswahl:** Prompts liegen pflegbar in der DB (`prompts`-Tabelle, `category` + `active`), **nicht hartcodiert**. Der Tages-Prompt wird gewichtet gezogen, **nie zweimal am Folgetag**, und in `daily_prompt` (Tag → Prompt) protokolliert — Grundlage, um im Pilot zu messen, welche Prompts viele Momente treiben. Technik: siehe `docs/STATUS.md` + Migrationen `0011`–`0013`.

### 4.3 Das Follow-System (verfallendes Publikum)

**Grundprinzip:** Ein Follow ist kein permanenter Zustand, sondern ein aktiver Entscheid alle 24 Stunden.

**Verfall ist individuell, nicht stadtweit** *(geändert 19. Aug 2026 — vorher: gemeinsamer 08:00-Reset)*. Jeder Follow trägt seine eigene Uhr: `follows.expires_at = followed_at + 24 h`. Es gibt keinen Moment mehr, in dem die ganze Stadt gemeinsam bei null startet.

Konkretes Beispiel:
- **Montag 14:00** — Du folgst Person A. Das Herz ist voll.
- **Montag 14:00 – Dienstag 02:00** — Das Herz läuft gleichmäßig leer. Erneuern ist noch nicht möglich.
- **Ab Dienstag 02:00 (nach 12 h)** — Erneuern wird möglich: einmal tippen → wieder volle 24 h.
- **Dienstag 14:00** — Kein Erneuern → Person A verschwindet aus „Ich folge" und taucht wieder in der Discovery auf.

**Regel:** Ein Follow lebt genau 24 Stunden ab dem letzten (Re-)Follow. Erneuern ist erst ab der zweiten Hälfte möglich (Follow ≥ 12 h alt) — sonst wäre der Verfall durch Dauer-Tippen aushebelbar.

🔒 Der Verfall ist **serverseitig per Trigger erzwungen**: ein Client kann seinen Ablauf vorziehen (entfolgen), aber niemals hinausschieben.

🔒 **LEITPLANKE: Follower-Zahlen sind für andere unsichtbar.** Nur private Zahl für dich selbst.

### 4.4 Die Stadt: zwei Feeds unter einem Menüpunkt *(neu geschnitten 2. Sep 2026)*

Der Menüpunkt **„Stadt"** (Achse 1, Broadcast) enthält zwei Feeds, umschaltbar über
einen halbdurchsichtigen Toggle oben im Screen:

| Feed | Inhalt | Logik |
|---|---|---|
| **Discovery** | Fremde, randomized | Entdeckung neuer Menschen |
| **Ich folge** | Leute denen du aktiv folgst (und die nicht im Circle sind) | Verfolgung bekannter Gesichter |

**Discovery-Verhalten:**
- Zeigt alle **lebenden** Momente der Stadt (jünger als 24 h), neueste zuerst, als endloser Scroll-Feed.
- Kein gemeinsamer Leerzustand mehr: der Feed atmet asynchron — laufend fällt unten etwas raus, während oben Neues dazukommt.
- Momente erscheinen unmittelbar nach dem Upload in der Discovery.
- Zeigt nur Leute, denen du noch nicht folgst — Circle-Partner erscheinen hier ebenfalls nie.
- ⚠️ Bei dünner Nutzerbasis kann der Feed sehr kurz oder leer sein — das ist die Regel, kein Fehler. Kein Auffüllen mit alten Momenten.
- Wem du hier folgst, wandert in den „Ich folge"-Feed.

**"Ich folge"-Verhalten:**
- **Verbindung beständig, Moment flüchtig:** dein Follow (24 h ab dem letzten (Re-)Follow, §4.3 unverändert) bleibt bestehen — **sichtbar im Feed ist aber nur, wer aktuell einen lebenden Moment hat.** Wer gerade nichts zeigt, ist vorübergehend unsichtbar und taucht mit dem nächsten Post wieder auf. Kein Karteileichen-Feed.
- Bewusste Konsequenz: Erneuern geht nur an sichtbaren Kacheln — wer nicht nachliefert, dessen Publikum läuft still aus (das IST die Schwerkraft aus §1).
- Circle-Partner erscheinen hier nicht — ihre Momente leben im Circle (§4.8).

### 4.5 Anstupsen — GEPARKT *(2. Sep 2026)*

Mit der neuen „Ich folge"-Regel (nur Menschen mit lebendem Moment sichtbar) hat das
Anstupsen keinen Ort mehr — es lebte auf den Leerkacheln der Personen ohne Moment.
**Entscheidung: erstmal parken.** UI entfernt; Tabelle `nudges`, Limit-Logik und
Block-Guard bleiben im Backend bestehen, damit eine spätere Wiederbelebung (z. B. im
Circle) keine Migration braucht.

### 4.6 Stadt Corso (Herzstück, Aufstieg)

- Fixe Uhrzeit: **21:00 Uhr**. Ganze Stadt sieht dieselben Momente, **maximal 8**. Die Auswahl steht eingefroren bis zur nächsten Ziehung 24 h später.
  - **Präzisiert (15. Juli, Entscheidung #6):** Der Stadt Corso läuft mit so vielen einwilligenden Momenten, wie an dem Tag da sind — **kein Mindest-Schwellwert, kein Fake-Auffüllen.** Bei dünner Nutzerbasis ist ein Stadt Corso aus 3 echten Momenten richtig, einer aus 8 aufgefüllten falsch.
- Auswahl: **gedämpft** (Follower erhöhen Chance mit abnehmendem Grenznutzen + Grundchance > 0).
- Kandidaten sind alle Momente, die zum Ziehungszeitpunkt **noch leben** (jünger als 24 h) und freigegeben sind.
- **Ein gezogener Moment bleibt den ganzen Stadt Corso lang sichtbar**, auch wenn seine 24 h währenddessen ablaufen — in Discovery/Ich folge/Rücklauf ist er dann weg, im Stadt Corso bleibt er stehen. Das Rampenlicht verlängert den Moment; ein Moment kann so bis zu ~48 h im Corso stehen.
- Wer noch nicht im Stadt Corso war, kann danach wie gewohnt gefolgt werden.
- Wer bereits gefolgt wird und in der Stadt Corso erscheint: kein Problem — der User sieht ob er schon renewed hat oder nicht.
- 🔒 **Keine sichtbaren Reaktions-/Follower-Zahlen während Stadt Corso.**
- **🔒 Einwilligung pro Moment, ob für den Stadt Corso freigegeben.**

### 4.7 Kippende Feed-Hierarchie
- Früh: Entdeckungs-Pool dominiert.
- Später: Verfolgungs-Feed übernimmt automatisch.

### 4.8 Der Circle (Achse 2: beständig, gegenseitig) — ENTSCHIEDEN *(2. Sep 2026)*

Ersetzt die frühere offene Verbindungs-Mechanik (Entscheidungen #2/#8).

- **Eintritt:** Zwei Menschen kommen in den Circle, wenn sie sich **wiederholt
  gegenseitig gefolgt** sind. Gezählt wird **+1 pro Corso-Tag mit gegenseitig
  aktivem Follow** (max. 1× pro Tag, nicht ertricksbar durch Entfolgen/Neu-Folgen
  am selben Tag). Schwelle: **konfigurierbar, Default 5 Tage insgesamt** — Lücken
  pausieren die Zählung, nichts wird zurückgesetzt.
- 🔒 **Die Schwelle und der Zählerstand sind für Nutzer unsichtbar** (serverseitig
  erzwungen: kein Lesepfad). Der Circle-Eintritt ist eine Überraschung und wird
  beim nächsten App-Öffnen **gefeiert angekündigt** („Jemand Neues in deinem Inner
  Circle — schreib ihm"), einmal pro Person (serverseitiger Gesehen-Stand).
- **Beständig:** Die Circle-Verbindung **verfällt nie** (kein Erneuern). Die
  **Momente** der Circle-Partner folgen weiter der 24h-Regel — im Circle-Feed
  steht nur, wer gerade einen lebenden Moment hat; die Partner-Leiste (Chat-
  Einstieg) ist dagegen beständig.
- **Unbegrenzt:** kein Limit auf die Circle-Größe.
- **Chat:** lebt **ausschließlich im Circle** und ist erst nach Circle-Eintritt
  möglich. Kein eigenes Chat-Menü. Block sperrt Chat und Sichtbarkeit serverseitig
  in beide Richtungen.
- **Zweiter Eintrittsweg: persönliche Circle-Einladung** *(ergänzt 2. Sep 2026,
  spät — Entscheidung Dominik)*: Ein Nutzer kann einen persönlichen Link teilen
  (`/c/<token>`), der den Empfänger direkt in den gemeinsamen Circle bringt — am
  5-Tage-Ritual vorbei, gedacht für Menschen, die sich ohnehin kennen. Gleiche
  Mechanik-Garantien wie beim verdienten Eintritt (Block-Check beidseitig,
  Ankündigung, `chat_reached` — in der Auswertung über `metadata.via =
  'circle_invite'` vom verdienten Weg trennbar). Migrationen `0026`/`0027`.
- Ziel unverändert: reales Treffen (App verlassen = Erfolg).
- Technik: `follow_mutual_days` (verdeckter Zähler) + Trigger auf `follows`,
  `connections` (Bestand seit 0003) + `circle_messages`; Migration `0024_circle.sql`.
  Kill-Metrik „verdiente Chats" = `chat_reached`-Events (eines pro Person bei
  Circle-Bildung).

### 4.9 Tagesablauf

Der Corso-Zyklus läuft **21:00 → 21:00** (Europe/Berlin). Wichtig: der Zyklus taktet **Prompt und Ritual**, nicht den Verfall — Momente und Follows laufen auf ihrer eigenen 24-Stunden-Uhr weiter.

| Zeit | Ereignis | Mechanik |
|---|---|---|
| **21:00** | Stadt-Corso + Zyklus-Start | Ziehung der max. 8 Momente **und** neuer Prompt, im selben Moment |
| **21:00–20:59** | Content-Phase | Posten, Discovery füllt sich, Anstupsen möglich |
| **20:45** | Anlauf zur Ziehung | Vorab-Push an alle („Gleich geht deine Stadt spazieren"), Story-Screen zeigt bis 21:00 den Countdown-Vorhang statt der auslaufenden Stadt Corso *(ergänzt 21. Aug 2026)* |
| **19–22 Uhr (variabel)** | Privater Corso (Push) | `[ENTSCHEIDUNG OFFEN]` |
| **laufend** | Individueller Verfall | Jeder Moment und jeder Follow stirbt 24 h nach seiner Entstehung — asynchron, jeder Nutzer hat seine eigene Uhr |
| **21:00 (Folgetag)** | Nächster Corso | Neue Ziehung ersetzt die alte, neuer Prompt |

> **Begriffspaar „Stadt Corso" / „Privater Corso"** (vereinheitlicht 19. Aug 2026): beide mit **C**, wie der App-Name. Der **Stadt Corso** ist das gemeinsame Ritual — die ganze Stadt sieht dieselben Momente. Der **Private Corso** ist das abendliche Push-Fenster (19–22 Uhr), in dem die Stadt gemeinsam flaniert.
> Früher war „Privater Korso" bewusst mit **K** geschrieben (italienisch/deutsch für Promenade). Das ist mit der Einführung des Namens „Stadt Corso" aufgegeben worden: zwei fast identische Wörter mit einem Buchstaben Unterschied sind eine Stolperfalle, kein Bedeutungsträger. **Nicht zurück auf K korrigieren.**

---

## 5. Screens & Flows

### Screen-Inventar *(Nav seit 2. Sep 2026: Stadt · Corso · Kamera · Circle · Du)*
1. Onboarding / ID-Verifizierung
2. Heute-Screen (Prompt + Countdown bis 21:00)
3. **Stadt** (ein Menüpunkt, zwei Feeds per Toggle: Discovery = nur Fremde, „Ich folge" = Gefolgte mit lebendem Moment)
4. **Corso** = Stadt Corso (21:00, vertikaler Karten-Feed wie Discovery, max. 8 Momente; Screen-Titel bleibt „Stadt Corso")
5. **Kamera** (Live-Kamera, Tippen=Foto/Halten=Video, Einwilligungs-Toggle für Stadt Corso)
6. **Circle** (beständige Partner-Leiste + moment-gated Feed + Chat; Ankündigungs-Splash bei neuem Circle)
7. **Du** (bisheriger Rücklauf: private Bilanz + Self-Screen + Weg zu den Einstellungen)
8. Settings / Safety

### Kern-Flows
- **A — Erster Abend:** Onboarding → ID → Heute → Push 21:00 → Stadt Corso → Discovery → folgen → optional ein eigener Moment.
- **B — Stammnutzer:** Prompt → Posten → "Ich folge" checken → Anstupsen → Stadt Corso → Rücklauf.
- **C — Aufstieg:** Moment mit Einwilligung → Stadt Corso → Publikum wächst → Rücklauf zeigt Sprung.
- **D — Dating-Ausgang:** Über Tage wiederholt gegenseitig folgen → Circle (Überraschung, gefeiert) → Chat → reales Treffen.

Prinzip: **Promenade zuerst, Kabine danach.**

---

## 6. Competition

| App | Abgrenzung |
|---|---|
| BeReal | Corso = Fremde + Dating-Ausgang, Ritual als Herz statt Notification |
| Snapchat | Corso = Entdeckung Unbekannter |
| Tinder/Hinge | Kein Profil, Chat als Belohnung |
| Raya/League | Corso = Event + tägliche Bewegung |
| TikTok | Lokal, bounded, verfallend statt akkumulierend |

**Moat:** Execution-Speed zu Stadt-Dichte. Strukturell: Match Group kann nicht ohne ihr eigenes Modell zu kannibalisieren nachbauen.

---

## 7. Monetization

- **Abo Membership (~€9–12/Monat):** Ticket zur Stadt.
- **Consumables:** nur Konsum/Reise (Städte-Zugang, Archiv).
- 🔒 **Verboten:** Publikum-Verfall verlängern, "wer folgt"-Einblick, Rampenlicht-Chance kaufen. Würde Design brechen. *(Strukturell abgesichert: `expires_at` wird per DB-Trigger erzwungen und ist vom Client nur verkürzbar.)*

---

## 8. Risiken

1. **Existenz:** Ist Alltagsmoment Fremder interessant genug für tägliche Rückkehr?
2. **Geschlechter-Asymmetrie:** Männer jagen, Frauen überrannt. `[MITIGATION OFFEN]`
3. **Frühphasen-Konsum-Tiefe:** Bei dünner Nutzerbasis ist der lebende 24-h-Topf klein — der Feed kann jederzeit fast leer sein. Der frühere „leere Morgen nach 08:00" ist mit dem individuellen Verfall verschwunden, das Dichte-Problem bleibt.
4. **Kritische Masse Stadt Corso:** Funktioniert erst ab ausreichender Nutzerdichte — Pilot mit 60–100 Usern könnte dünn wirken.

---

## 9. MVP / Pilot

Der Pilot läuft in zwei Schritten (siehe `docs/ROADMAP.md`):

**Schritt 1 — Gratis Freundes-Pilot (jetzt):**
- **Stadt:** Düsseldorf. **Tooling:** PWA (keine native App, kein Telegram).
- **Größe:** 20–30 Freunde. **Preis:** gratis.
- **Zweck:** misst NUR, ob der Kern-Loop zieht (täglich öffnen + posten). Beweist bewusst NICHT das Geschäft — Freunde nutzen aus Gefälligkeit.

**Schritt 2 — Zahlender Fremden-Pilot (später):**
- **Stadt:** Düsseldorf. **Dauer:** 4–6 Wochen. **Größe:** 60–100 zahlende Mitglieder. **Preis:** ab Tag 1 zahlend (€9).
- **Zweck:** erst dieser Schritt validiert das Geschäft.

**Kill-Metriken (gelten für die Pilot-Auswertung):**
- Woche-4 Daily-Open-Rate < 50 % → Konsum tot.
- Woche-4 aktiver-Moment-Anteil < 40 % → Supply tot.
- < 5 verdiente Chats → reale Dates → Dating-Ausgang tot.

**Out of Scope (beide Schritte):** Native App, Watermarking, autom. Algorithmus für den Stadt Corso, Consumables, mehrere Städte, volle ID-Verifizierung.

> ✅ Die 🔒 Leitplanke „Live-Kamera-Pflicht" ist in der PWA via `getUserMedia` nativ umgesetzt (`src/hooks/use-camera.ts`). Das frühere Telegram-Spannungsfeld entfällt.

---

## 10. Offene Entscheidungen (Status)

| # | Entscheidung | Status |
|---|---|---|
| 1 | Rampenlicht-Auswahl | **GEDÄMPFT** ✓ |
| 2 | Austausch-Runden bis Chat | **ERSETZT (2. Sep)** — Chat wird mit dem Circle-Eintritt frei (§4.8), keine Austausch-Runden mehr |
| 3 | Rücklauf zählt Pool-Zuschauer | **JA** ✓ |
| 4 | Strukturierter Treffen-Vorschlag UI | **NEIN** ✓ |
| 5 | Tech-Stack Pilot | **PWA** ✓ (native App nicht für Pilot) |
| 6 | Frequenz/Größe des Stadt Corso | **ENTSCHIEDEN (15. Juli)** ✓ — so viele einwilligende Momente wie da sind, max. 8, kein Minimum, kein Fake-Auffüllen (§4.6) |
| 7 | Privater Corso (Push 19–22 Uhr) — genaue Mechanik | offen — **wird mit dem Push-Feature in Roadmap-Phase 1 fällig** |
| 8 | Verbindungs-Trigger bei täglich-verfallenden Follows | **ENTSCHIEDEN (2. Sep)** ✓ — Circle-Schwelle: 5 Corso-Tage gegenseitig (konfigurierbar, versteckt), §4.8 |
| 9 | Live-Kamera-Lösung für Telegram-Pilot | **HINFÄLLIG** ✓ (PWA + `getUserMedia`, kein Telegram) |
| 10 | Mitigation Geschlechter-Asymmetrie | offen |

---

*Ende PRD v0.5 — Stand 2. September 2026.*