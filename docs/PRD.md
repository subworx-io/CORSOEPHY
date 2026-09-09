# Corso — Product Requirements Document

**Version:** 0.7 (Stand 9. September 2026)
**Status:** Pre-Pilot. Konzept final, Pilot als gratis Freundes-Pilot auf PWA spezifiziert. Der Freundes-Pilot ist **noch nicht gestartet** — es gibt bislang keine Signale zu den Kill-Metriken (§9).
**Eigner:** Maxim

> Single Source of Truth für Menschen und AI-Agents, die Corso aufbauen.
> Offene Entscheidungen sind als `[ENTSCHEIDUNG OFFEN]` markiert und dürfen nicht stillschweigend getroffen werden.
> Kritische Leitplanken sind mit 🔒 LEITPLANKE markiert — nicht verhandelbar ohne Freigabe des Eigners.
> Die priorisierte Bau-Reihenfolge steht in `docs/ROADMAP.md`, der tagesaktuelle Stand in `docs/STATUS.md`. Bei Konflikt gewinnt dieses PRD.

> **Changelog v0.6 → v0.7** (In-Place-Blättern, Entscheidung Dominik 9. Sep 2026, freigegeben):
> - **Die Momente eines Menschen sind EINE flache, lineare Sequenz** — kein verschachteltes „Bilder in Moment in Person". Ein Tipp geht immer genau einen Schritt weiter, egal ob der nächste Schritt das nächste Bild einer Reihe oder der nächste Moment ist. Gilt überall gleich: Discovery, Corso, „Ich folge", Circle, Rücklauf.
> - **Keine Zwischenebene mehr.** Es öffnet sich kein Vollbild-Layer mit Schließen-X; geblättert wird direkt auf der Kachel, auf der man schon steht. Die Route `/p/$handle` bleibt ausschließlich als **Deep-Link-Ziel** (Push, geteilte Links) — aus den Feeds führt kein Tap-Einstieg mehr dorthin.
> - **Ein einziger segmentierter Fortschrittsbalken** oben auf der Kachel (Instagram-Muster), sofort sichtbar ab dem zweiten Schritt. Bilder desselben Moments stehen als enge Segment-Gruppe zusammen, zwischen zwei Momenten ist mehr Luft — eine Zeile, keine zwei.
> - **Tipp-Zonen:** rechte Hauptfläche = weiter, linkes Drittel = zurück. Der obere Streifen (96 px) blättert nie zurück, damit der Ton-Knopf oben links bedienbar bleibt.
> - **Ende der Sequenz:** per Tipp nahtlos zur nächsten Person, kein Loop. **Auto-Advance** dagegen bleibt am Ende stehen — es reißt niemanden ungefragt weiter.
> - **Auto-Advance je Medium:** Bild 3 s, Video seine Laufzeit (`onEnded`). Ein Video loopt nur noch, wenn es der letzte Schritt ist.
> - **Corso 🔒:** In-Place-Blättern läuft dort **ausschließlich über Momente mit Corso-Freigabe** (`city_story_consent`). Ein Moment ohne Freigabe erscheint auch beim Blättern nie — der Filter steht in der Query, nicht in der Darstellung.
> - **Rücklauf:** dieselbe Mechanik, und die Zahlen stimmen zum jeweils angezeigten Moment — neue Funktion `my_moment_stats(post_id)` mit 🔒 serverseitigem Guard `author_id = auth.uid()` (Migrationen `0033`/`0034`). Personen-bezogene Zahlen (Follower, auf der Kippe, Serie) bleiben in `my_feedback()`.
>
> **Changelog v0.5 → v0.6** (Der laufende Corso, Entscheidung Dominik 9. Sep 2026, als Eigner-Entscheidung freigegeben):
> - **Der Stadt Corso läuft kontinuierlich.** Die tägliche 21:00-Ziehung mit eingefrorener Auswahl ist ersetzt durch feste **Slots** (Start 10, über `app_config.corso_slot_count` skalierbar). Eine Belegung endet exakt dann, wenn ihr Moment 24 h alt wird; ein Cron-Lauf (jede Minute) rückt den nächsten passenden Moment nach. Kein Reset, kein Leerlauf, keine vorhersehbare Uhrzeit. §4.6 neu.
> - **Der tägliche Prompt entfällt vollständig.** Es gibt keinen gemeinsamen Anlass mehr; der einzige Grund zu posten ist die Chance, dass ein Corso-Slot frei wird und der eigene Moment nachrückt. §4.2 gestrichen, §1/§4.9/§5 entsprechend. Die Tabellen `prompts`/`daily_prompt` bleiben als Pilot-Historie in der DB liegen, der Client liest sie nicht mehr. Damit entfällt bewusst auch die Auswertung „welcher Prompt treibt Momente" (`prompt_performance`).
> - **Mehrere lebende Momente pro Person erlaubt** (kippt die bisherige Regel in §4.1). Nötig, damit ein neuer Post den bereits laufenden Corso-Slot desselben Menschen nicht herausreißt. Pro Person steht weiterhin nur EIN Moment im Corso; Discovery und „Ich folge" zeigen weiterhin EINE Kachel pro Person (den neuesten Moment).
> - **Neuer Screen „Profil"** (`/p/$handle`): alle lebenden Momente eines Menschen, durchswipebar. Einstieg per Tipp auf den Handle — bewusst keine neue Geste, weil in den Feeds beide Achsen belegt sind.
> - **Gestrichen:** die Regel „ein gezogener Moment bleibt bis zu ~48 h sichtbar". Eine Corso-Belegung endet jetzt exakt mit den 24 h des Moments.
> - **Push:** Ritual-Push (21:01) und Vorab-Push (20:45) abgeschaltet. Neu: persönlicher Push **„Du stehst im Corso"**, wenn der eigene Moment nachrückt. Das Thema „was passiert um 21 Uhr als Event" bleibt **bewusst geparkt** — es wurde kein Ersatz gebaut.
> - **Unverändert:** `corso_day()` (21:00→21:00) bleibt intern tragend für den verdeckten Circle-Zähler, Anstups-Limit, Snapshots und Push-dedupe. Der Circle (§4.8) ist nicht angefasst.
> - Migrationen `0031_corso_running.sql`, `0032_multiple_living_moments.sql`.
>
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

Corso ist eine **lokale Stadtbeobachtungs-App mit Dating-Ausgang**. Jeder postet seinen Moment, die Stadt scrollt, folgt, vergisst oder erinnert sich. Auf der Bühne der Stadt — dem **Stadt Corso** — steht eine feste Zahl von Momenten, und sie läuft rund um die Uhr: sobald ein Moment seine 24 Stunden erreicht, wird sein Platz frei und ein anderer rückt nach. Wer dort gefällt, gewinnt **Publikum** — aber jeder Follow **verfällt 24 Stunden nach dem Follow**, wenn man nicht nachliefert.

### Zentrale emotionale Mechanik
- **Stadt Corso = Aufstieg.** Random, plötzlich, vor der ganzen Stadt — und jederzeit möglich, nicht nur zu einer Uhrzeit.
- **Verfallendes Publikum = Schwerkraft.** Wer nicht nachliefert, sinkt.

Zusammen: ständige Bewegung statt statischer Hierarchie.

---

## 2. Value Proposition

**Konsument (primär):** "Ich sehe, wie meine Stadt gerade wirklich lebt."
**Produzent (sekundär):** "Jeden Moment könnte die ganze Stadt mich sehen."

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
- **Kein Prompt, kein vorgegebener Anlass** *(geändert 9. Sep 2026 — vorher: täglicher Prompt)*. Der einzige Anlass zu posten ist die Chance, dass im Stadt Corso ein Platz frei wird und der eigene Moment nachrückt.
- **Lebensdauer eines Moments: genau 24 h ab dem Upload.** Jeder Moment trägt seine eigene Uhr (`posts.expires_at = created_at + 24 h`), es gibt keinen stadtweiten Reset. Danach ist er überall weg — auch für den Autor.
- **Mehrere lebende Momente pro Person sind erlaubt** *(geändert 9. Sep 2026 — vorher: genau einer)*. Ein neuer Moment beendet den vorherigen NICHT; beide laufen auf ihrer eigenen 24-h-Uhr. Grund: ein neuer Post soll den bereits laufenden Corso-Platz desselben Menschen nicht herausreißen.
  - In **Discovery** und **„Ich folge"** steht trotzdem nur EINE Kachel pro Person — ihr **neuester** Moment. Sonst füllte ein Vielposter den dünnen Feed allein.
  - Alle weiteren lebenden Momente erreicht man durch **In-Place-Blättern auf der Kachel** (Tipp = ein Schritt weiter), nicht über eine eigene Ansicht.
  - Im **Stadt Corso** steht pro Person immer nur ein Moment (serverseitig erzwungen).

### 4.2 Der Anlass zu posten — GESTRICHEN als Prompt *(9. Sep 2026)*

**Es gibt keinen täglichen Prompt mehr.** Bis zum 8. September erschien um 21:00 ein
stadtweit identischer Prompt, auf den alle antworteten. Das ist ersatzlos entfallen:

- Der einzige Anlass zu posten ist die **Chance auf einen freien Platz im Stadt
  Corso** (§4.6). Weil die Plätze laufend frei werden, gibt es diese Chance
  jederzeit — nicht nur zu einer Tageszeit.
- Momente sind unmittelbar nach dem Upload in der Discovery sichtbar.
- **Ton (Anti-Test), unverändert gültig:** „Würde ich das entspannt an einem
  normalen Dienstagabend vor 500 Fremden aus meiner Stadt zeigen, ohne lange zu
  überlegen?" Wenn nein → zu heavy. Passeggiata statt Beichte.

**Was mit der Prompt-Mechanik passiert ist:** Die Tabellen `prompts` (40 aktive
Prompts, 3 Kategorien) und `daily_prompt` (35 Zeilen Historie) **bleiben in der
Datenbank liegen** — nichts wird gelöscht, die Historie bleibt auswertbar. Der
Client liest sie nicht mehr; `get_today_prompt()` wird von niemandem mehr
aufgerufen, es gab dafür nie einen Cron. Bewusst in Kauf genommen: die Auswertung
„welche Prompts treiben viele Momente" (View `prompt_performance`) entfällt.

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

### 4.6 Stadt Corso (Herzstück, Aufstieg) — LAUFEND *(neu geschnitten 9. Sep 2026)*

**Der Corso hat keine Uhrzeit mehr. Er läuft.**

- **Feste Zahl von Plätzen (Slots): Start 10**, konfigurierbar über
  `app_config.corso_slot_count` — größere Städte bekommen später schlicht einen
  höheren Wert, ohne Migration. *(Bis 8. Sep: max. 8, einmal täglich gezogen.)*
- **Eine Belegung endet exakt dann, wenn ihr Moment 24 h alt wird.** Dann wird
  der Platz frei, und der Algorithmus rückt den nächsten passenden Moment nach.
  Der Corso ist dadurch immer voll und jederzeit aktuell — **kein vorhersehbarer
  Reset, kein Leerlauf, kein Einfrieren.**
- **Ganze Stadt sieht dasselbe.** Die Besetzung liegt serverseitig (Tabelle
  `corso_slots`), nicht in einer Ziehung pro Gerät.
- **Kandidaten** sind alle Momente, die gerade **leben** (jünger als 24 h) und
  🔒 für den Stadt Corso freigegeben sind, deren Autor gerade keinen Platz belegt
  und deren Moment noch nie im Corso stand (kein Wiedereintritt).
- **Auswahl: gedämpft, unverändert** (Follower erhöhen die Chance mit abnehmendem
  Grenznutzen, Grundchance > 0; `w = 1 + ln(1 + aktive Follower)`, Ziehung ohne
  Zurücklegen). Verifiziert unter dem laufenden Modell:
  `node scripts/verify-corso-weighting.mjs`.
  - **Befund (9. Sep 2026):** Das laufende Modell ist **gerechter** als die alte
    Tagesziehung, nicht ungerechter. Bei gleicher Bevölkerung fällt die Spreizung
    zwischen einem „Whale" (800 Follower) und einem Neuling (0 Follower) von
    **6,1× auf 2,6×**, die Chance des Neulings steigt von ~10 % auf ~34 % je
    Moment. Grund: pro Person ist immer nur ein Platz belegt, und der höhere
    Durchsatz (≈15 statt 8 Einzüge/Tag) verteilt die Bühne auf mehr Menschen.
- **Pro Person immer nur EIN Moment im Corso.** Ein neuer Post ersetzt den
  laufenden Platz **nicht** — er lebt daneben (§4.1) und ist über das Profil
  sichtbar.
- **Kein Mindest-Schwellwert, kein Fake-Auffüllen** *(Entscheidung #6, 15. Juli,
  weiterhin gültig)*. Bei dünner Nutzerbasis stehen eben 3 von 10 Plätzen — ein
  Corso aus 3 echten Momenten ist richtig, einer aus 10 aufgefüllten falsch.
- ~~Ein gezogener Moment bleibt bis zu ~48 h sichtbar~~ — **gestrichen 9. Sep
  2026.** Die Belegung endet exakt mit den 24 h des Moments; das Rampenlicht
  verlängert nichts mehr.
- Wer noch nicht im Stadt Corso war, kann danach wie gewohnt gefolgt werden.
- Wer bereits gefolgt wird und im Stadt Corso erscheint: kein Problem — der User
  sieht, ob er schon erneuert hat oder nicht.
- **Rückmeldung an den Autor:** Rückt der eigene Moment nach, geht ein
  persönlicher Push heraus („Du stehst im Corso"). 🔒 Ohne jede Zahl.
- 🔒 **Keine sichtbaren Reaktions-/Follower-Zahlen im Stadt Corso.**
- **🔒 Einwilligung pro Moment, ob für den Stadt Corso freigegeben.**
- Technik: `corso_slots` + `refill_corso()` (pg_cron `corso-refill`, jede Minute)
  + Lesepfad `corso_now()`; Migration `0031_corso_running.sql`.

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

### 4.9 Tagesablauf — es gibt keinen mehr *(neu 9. Sep 2026)*

**Corso hat keinen Tagesablauf mehr.** Alles läuft asynchron und rund um die Uhr.

| Zeit | Ereignis | Mechanik |
|---|---|---|
| **laufend** | Nachbesetzung des Corso | Wird ein Platz frei (der Moment darauf erreicht seine 24 h), rückt gewichtet der nächste passende Moment nach. Der Autor bekommt einen persönlichen Push. Takt: jede Minute (pg_cron `corso-refill`) |
| **laufend** | Individueller Verfall | Jeder Moment und jeder Follow stirbt 24 h nach seiner Entstehung — asynchron, jeder Nutzer hat seine eigene Uhr |
| **laufend** | Content-Phase | Posten und Entdecken zu jeder Zeit; der Anlass ist der freie Platz, nicht die Uhrzeit |
| ~~21:00~~ | ~~Ziehung + neuer Prompt~~ | **Entfallen.** Ersetzt durch die laufende Nachbesetzung |
| ~~20:45~~ | ~~Vorab-Push + Countdown-Vorhang~~ | **Entfallen.** Cron abgestellt |
| **19–22 Uhr (variabel)** | Privater Corso (Push) | `[ENTSCHEIDUNG OFFEN]` |

> ⚠️ **Bewusst geparkt:** „Was passiert um 21 Uhr als Event?" — der alte Reset ist
> entfernt worden, **ohne** einen Ersatz-Event zu bauen. Das ist keine Lücke,
> sondern eine Entscheidung (Dominik, 9. Sep 2026). Wer hier etwas erfinden will:
> erst fragen.

> ℹ️ **Der Corso-Zyklus (21:00 → 21:00) existiert technisch weiter, aber unsichtbar.**
> `corso_day()` trägt den verdeckten Circle-Zähler („5 gegenseitige Corso-Tage",
> §4.8), das Anstups-Limit, die Snapshot-Basis und die dedupe_keys der
> Push-Anlässe. **Nicht entfernen** — er taktet nur nichts mehr, das man sieht.

> **Begriffspaar „Stadt Corso" / „Privater Corso"** (vereinheitlicht 19. Aug 2026): beide mit **C**, wie der App-Name. Der **Stadt Corso** ist das gemeinsame Ritual — die ganze Stadt sieht dieselben Momente. Der **Private Corso** ist das abendliche Push-Fenster (19–22 Uhr), in dem die Stadt gemeinsam flaniert.
> Früher war „Privater Korso" bewusst mit **K** geschrieben (italienisch/deutsch für Promenade). Das ist mit der Einführung des Namens „Stadt Corso" aufgegeben worden: zwei fast identische Wörter mit einem Buchstaben Unterschied sind eine Stolperfalle, kein Bedeutungsträger. **Nicht zurück auf K korrigieren.**

---

## 5. Screens & Flows

### Screen-Inventar *(Nav seit 2. Sep 2026: Stadt · Corso · Kamera · Circle · Du)*
1. Onboarding / ID-Verifizierung
2. ~~Heute-Screen (Prompt + Countdown bis 21:00)~~ — **entfallen 9. Sep 2026** (kein Prompt, kein Countdown)
3. **Stadt** (ein Menüpunkt, zwei Feeds per Toggle: Discovery = nur Fremde, „Ich folge" = Gefolgte mit lebendem Moment; je EINE Kachel pro Person = ihr neuester Moment)
4. **Corso** = Stadt Corso (laufend, vertikaler Karten-Feed wie Discovery, 10 Plätze; Screen-Titel bleibt „Stadt Corso")
5. **Kamera** (Live-Kamera, Tippen=Foto/Halten=Video, Einwilligungs-Toggle für Stadt Corso)
6. **Circle** (beständige Partner-Leiste + moment-gated Feed + Chat; Ankündigungs-Splash bei neuem Circle)
7. **Du** (bisheriger Rücklauf: private Bilanz + Self-Screen + Weg zu den Einstellungen)
8. Settings / Safety
9. **Profil** *(neu 9. Sep 2026, `/p/$handle`)* — alle lebenden Momente eines Menschen, horizontal durchswipebar. **Kein Nav-Punkt**, sondern eine Ansicht über allem: Einstieg per **Tipp auf den Handle** in Discovery, „Ich folge" und Corso.
   - 🔒 **Gesten-Trennung:** In den Feeds sind beide Achsen belegt (vertikal = Moment wechseln, horizontal = folgen/entfolgen). Deshalb ist der Einstieg ein Tipp, keine Geste, und die Ansicht bringt ihren **eigenen Gesten-Container** mit. Darin: horizontal = zwischen den Momenten, Wisch nach unten = schließen, Tipp links/rechts = zurück/weiter. **Kein Follow-Wisch** — Folgen läuft hier über einen expliziten Knopf, damit dieselbe Geste nicht an zwei Orten Verschiedenes bedeutet.
   - 🔒 Keine Follower-Zahl, kein Archiv: nur was gerade lebt.

### Kern-Flows
- **A — Erster Besuch:** Onboarding → ID → Stadt Corso (wer steht gerade drauf?) → Discovery → folgen → optional ein eigener Moment.
- **B — Stammnutzer:** Posten (in der Hoffnung auf einen freien Platz) → "Ich folge" checken → Stadt Corso → Push „Du stehst im Corso" → Rücklauf.
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
4. **Kritische Masse Stadt Corso:** Funktioniert erst ab ausreichender Nutzerdichte — Pilot mit 60–100 Usern könnte dünn wirken. Mit dem laufenden Corso ist die Bühne bei dünner Basis meist nicht voll (10 Plätze, wenige einwilligende Momente) — das ist die gewollte Ehrlichkeit, kein Fehler.
5. **Wegfall des gemeinsamen Anlasses** *(neu 9. Sep 2026)*: Prompt und 21:00-Ritual waren die beiden Dinge, die die Stadt gleichzeitig aktiviert haben. Der laufende Corso ersetzt sie durch eine ständige, aber leisere Chance. Ob das genug Zug erzeugt, ist offen — **es ist die zentrale Wette dieses Umbaus** und im Pilot direkt an der Post-Rate ablesbar.

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
| 6 | Frequenz/Größe des Stadt Corso | **NEU ENTSCHIEDEN (9. Sep 2026)** ✓ — laufend statt täglich, 10 Plätze (konfigurierbar), kein Minimum, kein Fake-Auffüllen (§4.6) |
| 7 | Privater Corso (Push 19–22 Uhr) — genaue Mechanik | offen |
| 11 | „Was passiert um 21 Uhr als Event?" | **BEWUSST GEPARKT (9. Sep 2026)** — der Reset ist entfernt, ein Ersatz wurde absichtlich NICHT gebaut |
| 8 | Verbindungs-Trigger bei täglich-verfallenden Follows | **ENTSCHIEDEN (2. Sep)** ✓ — Circle-Schwelle: 5 Corso-Tage gegenseitig (konfigurierbar, versteckt), §4.8 |
| 9 | Live-Kamera-Lösung für Telegram-Pilot | **HINFÄLLIG** ✓ (PWA + `getUserMedia`, kein Telegram) |
| 10 | Mitigation Geschlechter-Asymmetrie | offen |

---

*Ende PRD v0.5 — Stand 2. September 2026.*