# Scroll-Umbau: vom JS-Feed zum nativen Scrollen

**Status:** ✅ **umgesetzt, live und am iPhone abgenommen** (16. September 2026).
Committet in `828f03d` (16. Sep 2026) — Stand der Umsetzung und Testergebnis: Abschnitt 0.
**Angelegt:** 4. September 2026 (als Konzept, danach bis 16. Sep geparkt)
**Auslöser:** Dominik, nach dem Test am iPhone — „ich kenne halt Apps, wo es einfach
flüssiger aussieht, mehr fps quasi"
**Betrifft:** die zentrale Interaktion der App (Discovery, Ich folge, Stadt Corso, Circle)

---

## 0. Umsetzung (16. September 2026)

> Die Abschnitte 1–11 sind das **ursprüngliche Konzept** und bleiben als
> Begründung stehen. Wo die Umsetzung davon abweicht, steht es hier. Maßgeblich
> für den heutigen Stand ist der Code, nicht die Schritt-Liste in Abschnitt 5.

### Was gebaut wurde

| Datei | Änderung |
|-------|----------|
| `src/styles.css` | Neue Klassen **`snap-feed`** (Container) und **`snap-feed-slide`** (Kachel) — die einzige Definition des Zielbilds aus Abschnitt 4, für alle vier Feeds gleich. Zusätzlich `overflow-x: hidden` (rausfliegende Swipe-Karten erzeugen sonst Quer-Scroll), `overflow-anchor: none` (siehe unten), ausgeblendete Scrollbar. |
| `src/hooks/use-snap-scroll.ts` | Neu geschrieben: **726 → 451 Zeilen** (Stand `1e070b2` → heute). Keine Feder, kein Gummiband, kein Momentum, kein Wheel-Handler, kein `axis`-Parameter, kein `realign`, kein `SNAP_MS`. |
| `discovery-feed.tsx`, `following-feed.tsx`, `story.tsx`, `circle.tsx` | Slides stehen im Fluss (`snap-feed-slide`) statt absolut mit `zIndex`. Seitenpunkte, Corso-Pille und Wisch-Hinweis liegen **außerhalb** des Scrollers, sonst scrollten sie mit. |

Der Hook macht nur noch vier Dinge:

1. **Aktiver Index** (`currentIndex`): `IntersectionObserver`, `threshold: 0.5`,
   `root` = Container — wie in Schritt 2 geplant.
2. **Ende der Bewegung** (`settledIndex`): `scrollend` plus Ruhe-Timer. Ohne
   `scrollend` sind es 120 ms, mit `scrollend` 250 ms als reines
   Sicherheitsnetz, weil nicht jede Engine nach einem harten `scrollTop`-Sprung
   ein `scrollend` meldet. Als „steht" gilt eine Position erst, wenn sie auf
   ±2 px auf einer Kachel liegt und kein Finger mehr aufliegt.
3. **Quer-Wisch und Tipp** aus **Pointer-Events** (siehe Abweichungen).
4. **Die sichtbare Kachel festhalten**, wenn sich die Liste darüber ändert
   (Fallstrick 4, siehe Abweichungen).

### Die Fallstricke — wie sie gelöst sind

| # | Fallstrick | Lösung |
|---|------------|--------|
| 1 | Swipe-Follow neben nativem Scrollen | `touch-action: pan-y` auf Container und Kacheln. Kein `preventDefault`, alle Listener passiv. Beginnt der Browser vertikal zu scrollen, schickt er `pointercancel` — der Achsen-Lock liegt damit beim Browser. **Am iPhone bestätigt.** |
| 2 | Choreografien an fester Dauer | `snapTo(i, onSettled)` — der Callback läuft erst, wenn die Bewegung wirklich steht. Discovery (Folgen) und „Ich folge" (Entfolgen) nehmen die Kachel erst dann aus der Liste. Der Timer `SWIPE_EXIT_MS` bleibt, weil das Rausfliegen der Karte eine CSS-Transition mit fester Dauer ist. `SNAP_MS` ist gestrichen. |
| 3 | `scrollend` ist neu | Ruhe-Timer als Ersatz (siehe oben). **Nicht gemessen:** ob das Pilot-iPhone `scrollend` meldet — beide Wege führen zum selben Ergebnis. |
| 4 | Element entfernen verschiebt das Bild | Eigenes Festhalten in einem `useLayoutEffect`, der nach jedem Commit **vor dem Malen** läuft: Hat sich die zuletzt ruhende Kachel verschoben, springt `scrollTop` unsichtbar mit. Läuft nie, solange ein Finger aufliegt oder der Feed sich bewegt. **Am iPhone bestätigt** (kein Sprung nach Folgen/Entfolgen). |
| 5 | Kacheln exakt gleich hoch | `height: 100%` vom Container. Dazu ein `ResizeObserver`, der im Ruhezustand auf den Index nachzieht, falls die Browser-Leiste die Höhe ändert. |
| 6 | Backlog #23 (klebt zwischen zwei Momenten) | Die Ursache `getDim()` gibt es nicht mehr. **Nicht gezielt nachgetestet** — siehe „Noch offen". |
| 7 | Video-Dekodierung | Medien-Fenster jetzt **auch in „Ich folge", Corso und Circle** (vorher liefen dort alle Videos gleichzeitig). **Nachgeschärft am selben Abend** (`lib/feed-media-window.ts`): Beim schnellen Wischen hinkte das Fenster am `settledIndex` hinterher, die Zielkachel wurde erst nach dem Stillstand geladen (~0,5 s schwarz). Jetzt richtet sich das Einbauen sofort nach dem aktiven Index, 3 Kacheln in Bewegungsrichtung voraus und 1 zurück. Abgebaut wird erst im Stillstand. Die nächsten 2 Videos werden **vorgewärmt** (einmal stumm `play()` → `pause()`), weil iOS mit `preload="auto"` allein nichts vorlädt. Dazu `#t=0.001` an der Quelle für ein erstes Bild. Discovery lädt 8 statt 3 Kacheln vor dem Ende nach. |

### Abweichungen vom Konzept — bewusst

- **Pointer-Events statt Touch-Events** für Quer-Wisch und Tipp. Das
  `pointercancel` beim Scroll-Start ist genau das Signal, das der Achsen-Lock
  braucht. Die Maus am Desktop läuft über denselben Pfad, der eigene
  Maus-Drag-Effekt ist weg.
- **Es gibt einen `scroll`-Listener** — entgegen Schritt 2. Er ist passiv und
  setzt nur ein Flag plus den Ruhe-Timer. Der Index wird **nicht** daraus
  berechnet. Das kostet nichts am Compositor, weil passive Listener das
  Scrollen nicht aufhalten.
- **`overflow-anchor: none` statt Browser-Scroll-Anchoring.** Chrome hätte es,
  bei Safari ist die Unterstützung unsicher. Das eigene Festhalten (Fallstrick 4)
  verhält sich auf allen Engines gleich.
- **Automatisches Festhalten ändert ein Verhalten:** Sortiert ein Refetch neue
  Momente oben in Discovery ein, bleibt man jetzt bei der Person, die man gerade
  ansieht. Vorher wechselte der Inhalt unter dem Finger.
- **`realign(i)` gibt es nicht mehr** (Schritt 5) — das Festhalten ersetzt es,
  die Feeds rufen nichts mehr nach.
- **`use-swipe-follow.ts` ist unverändert.** Die Schnittstelle `onSwipeX` bleibt,
  die in Abschnitt 7 angedachte Vereinfachung war nicht nötig.
- **`TapInfo` trägt jetzt `rect`** (das Container-Rechteck). Die Feeds brauchen
  dafür kein `containerRef.current` mehr.
- **Ein Tipp, der eine laufende Scroll-Bewegung anhält, zählt nicht als Tipp** —
  sonst blätterte das Anhalten eines Flicks nebenbei die Sequenz weiter.
- **Der Container ist State, kein reiner Ref** (Callback-Ref). Mehrere Screens
  mounten ihn erst später (Ladezustand, leer → besetzt). Die alte Fassung hängte
  dort ihren `ResizeObserver` nie an (Befund einer Parallel-Session).
- **Die BottomNav** (schrumpft beim Scrollen, `lib/scroll-activity.ts`, Arbeit
  einer Parallel-Session vom selben Tag) hörte beim alten Hook auf ein eigenes
  `pingScrollActivity()`. Das ist raus: Der native Feed feuert echte
  `scroll`-Events, die der Capture-Listener am Dokument ohnehin bekommt.

### Nachtrag: Quer-Wisch während des Einrastens (16. Sep 2026, spät)

**Befund (Dominik, iPhone):** Setzt man den Finger auf, während der Feed nach
einem Wisch noch einrastet, lässt sich die nächste Kachel nicht quer wischen —
der Feed scrollt stattdessen weiter. **Ursache:** iOS gibt eine Berührung auf
einem noch laufenden Scroller direkt an den Scroll weiter. Unser Hook bekommt
nur `pointercancel`, der Quer-Wisch kommt nie an. `touch-action: pan-y` greift
in diesem Moment nicht. Der eigene Code hat nichts blockiert.

**Lösung: Schutzfläche** (`snap-feed-shield` in `styles.css`, gesteuert von
`use-snap-scroll`). Eine unsichtbare Fläche neben dem Scroller mit
`touch-action: none` ist **nur aktiv, solange der Feed ohne Finger nachläuft**
(Momentum, Einrasten, `snapTo`), und nur nach Touch-Eingabe. Am Desktop würde
sie sonst das Mausrad blockieren. Eine Berührung landet dann dort statt im
Scroller:

- **quer** → Swipe-Follow auf der Kachel, auf die der Feed gerade zuläuft,
- **senkrecht** → ein Schritt weiter oder zurück per `snapTo`. Bewusst kein
  Mitziehen am Finger: Das ginge nur per JS-Scroll.
- **Tipp** → zählt nicht, wie schon vorher beim Anhalten einer Bewegung.

Aus ist sie, sobald die Bewegung steht, spätestens nach 1,2 s
(Sicherheitsnetz). Eine Geste, die auf ihr begonnen hat, läuft auf ihr zu Ende.
Sie liegt auf z 15, unter den Bedienelementen der Screens (ab z 20). Während
des Nachlaufens (~0,3 s) sind Menü- und Ton-Knopf auf der Kachel kurz nicht
antippbar.

✅ **Am iPhone abgenommen (Dominik, 16. Sep spät):** WebKit gibt die Berührung
der Fläche und nicht dem laufenden Scroller, so wie angenommen. Getestet und
bestätigt:

| Test | Ergebnis |
|------|----------|
| Schnell mehrere Kacheln hintereinander — Momente sofort da (Vorladen, Fallstrick 7) | ✅ |
| Direkt nach dem Loslassen quer wischen — Folgen klappt, kein Weiterscrollen | ✅ |
| Direkt nach dem Loslassen senkrecht nachwischen — genau eine Kachel weiter | ✅ |
| Normales Scrollen im Ruhezustand unverändert | ✅ |
| Login und „Ich folge" nach dem Deploy (mit Änderungen einer Parallel-Session an `auth-context`/`follow-context`) | ✅ |

### Nebenwirkung, die man kennen muss

Die Feeds sind jetzt **native Scroller** wie Rücklauf und Einstellungen. Damit
betrifft sie auch der WebKit-Bug 222654 (Wischgeste „latcht" in der
installierten PWA aufs Dokument). Der Workaround `html, body { height: 100%;
overflow: hidden }` in `styles.css` ist deshalb jetzt **tragend für die ganze
App** — nicht entfernen. Details: `docs/STATUS.md`, Chronik vom 2. September.

### Deploy und Abnahme

- **Deployed:** 16. Sep 2026, ~21:55 (`bash scripts/deploy.sh`, Deployment
  `e46d9755`). Mit ausgeliefert wurde die damals noch nicht committete BottomNav-Arbeit der
  Parallel-Session (schrumpfende Leiste, größerer Kamera-Knopf).
- **Vorher ein Fehlalarm, der sich lehrreich wiederholen kann:** Der Umbau lag
  lokal fertig vor, der Live-Stand war aber noch der alte Hook. Das Gefühl
  „hat sich nichts geändert" kam daher. Prüfweg: Im ausgelieferten
  `use-snap-scroll-*.js` darf **kein** `passive:!1` stehen, und die geladene
  `styles-*.css` muss `snap-feed` enthalten.
- **Am iPhone abgenommen (Dominik, 16. Sep abends)** gegen `corso-app.pages.dev`
  (ob installierte PWA oder Safari-Tab, ist nicht festgehalten):

| Test | Ergebnis |
|------|----------|
| Langsam ziehen, in der Mitte halten — beide Momente sichtbar, weiches Einrasten erst beim Loslassen | ✅ |
| Kurzer schneller Wisch — genau eine Kachel weiter | ✅ |
| Rechts-Wisch zum Folgen — Feed scrollt nicht mit, kein Sprung danach | ✅ |
| Tipp-Zonen (links zurück, rechts weiter) | ✅ |
| BottomNav schrumpft beim Wischen in Stadt und Corso | ✅ |
| Obere Kachel wechselt beim Halten in der Mitte **nicht** ihr Bild | ✅ (war als Risiko vermutet, tritt nicht auf) |

### Noch offen

- **Backlog #23** (von Stadt weg und zurück → klebt zwischen zwei Momenten)
  gezielt nachtesten. Die Ursache ist entfallen, bewiesen ist es nicht.
- **Nachlade-Grenze** in Discovery (~alle 20 Kacheln) mit vollem Feed — am
  Testabend war der Feed dafür vermutlich zu kurz.
- **Entfolgen per Links-Wisch** in „Ich folge" und **Circle** wurden nicht
  einzeln abgefragt.
- **Messung mit dem Safari Web Inspector** (Abschnitt 9) ist nicht gemacht —
  die Abnahme ist Gefühl am Gerät, keine Timeline.

---

## 1. Worum es geht

Der Feed scrollt spürbar weniger flüssig als TikTok oder Instagram. Der Grund ist
nicht die Abstimmung der Animation, sondern **wer sie ausführt**: Corso animiert
das Scrollen in JavaScript, native Apps lassen das System scrollen.

Dieses Dokument beschreibt den Umbau auf natives Scrollen mit CSS Scroll Snap —
und vor allem die Fallstricke, die dabei zu erwarten sind.

---

## 2. Der Befund (warum Feintuning nicht reicht)

`src/hooks/use-snap-scroll.ts` fängt jede Berührung selbst ab, berechnet pro Bild
eine neue Position und schreibt sie per `transform` auf die Slides. Die
Einrast-Animation läuft über `requestAnimationFrame`.

Das hat eine harte Obergrenze:

- **Alles läuft auf dem Haupt-Thread.** Jeder React-Render, jede Video-Dekodierung
  und jeder Netzwerk-Callback konkurriert mit der Animation um dieselbe
  Rechenzeit. Ein einziger langer Task lässt Frames ausfallen.
- **Natives Scrollen läuft dagegen im Compositor**, also auf einem eigenen Thread
  direkt an der Grafikeinheit. Es läuft weiter, selbst wenn JavaScript gerade
  blockiert — und erreicht die volle Bildrate des Displays.
- Genau daher kommt der Eindruck „mehr fps". Es ist kein Gefühl, sondern ein
  Architektur-Unterschied.

**Konsequenz:** Solange die Bewegung aus JavaScript kommt, ist der Abstand zu
nativen Apps nicht zu schließen. Kein Federparameter der Welt ändert das.

---

## 3. Was vor dem Umbau gemacht war

> *Stand 4. September. Was „entfällt" markiert ist, ist seit dem 16. September
> tatsächlich weg; A2 und C gelten weiter.*

Alles Folgende war **live** und hat das Ruckeln messbar reduziert, aber das
fps-Thema nicht gelöst. Es war trotzdem nicht umsonst: Die Punkte 1–3 bleiben
auch nach dem Umbau relevant.

| # | Was | Wo | Wirkung |
|---|-----|----|---------|
| A1 | Touch-Listener registrieren sich nur noch einmal statt bei jeder Slide-Zahl-Änderung (`count` liegt in einem Ref, dadurch sind `clampIndex`/`snapTo` stabil) | `use-snap-scroll.ts` | behebt echten Gesten-Abbruch beim Nachladen |
| A2 | Video-Fenster hängt am `settledIndex` statt am aktiven Index — keine `<video>`-Mounts mitten in der Geste | `use-snap-scroll.ts`, `discovery-feed.tsx` | bleibt nach dem Umbau sinnvoll |
| B3 | `applyPos` schreibt nur noch im Fenster ±3 statt in alle Slides; was herausfällt, wird einmal auf `visibility: hidden` gesetzt | `use-snap-scroll.ts` | **entfällt** mit dem Umbau |
| C | `mix-blend-mode: overlay` und `backdrop-filter` von den bewegten Kacheln entfernt | `discovery-feed.tsx`, `story.tsx`, `video-tile.tsx` | bleibt relevant |
| D | Feste 380-ms-Kurve → kritisch gedämpfte Feder mit Übernahme der Wisch-Geschwindigkeit, Rand-Gummiband, Momentum auf ±1 Kachel geklemmt | `use-snap-scroll.ts` | **entfällt** — das macht dann das System |

**Erkenntnis aus D, die man leicht falsch rät:** Die erste Federhärte (260) hätte
250 ms sichtbare Bewegung gebraucht — die alte feste Kurve war nach ~230 ms
optisch fertig. Sie wäre also *träger* gewesen als der Zustand davor. Die
Messtabelle steht als Kommentar über `SPRING_STIFFNESS`.

---

## 4. Zielbild

```
Container:  overflow-y: auto
            scroll-snap-type: y mandatory
            overscroll-behavior: contain     /* kein Pull-to-Refresh im Feed */

Slide:      scroll-snap-align: start
            scroll-snap-stop: always         /* max. eine Kachel pro Geste */
            height: 100%                     /* ALLE exakt gleich hoch */
```

Das ersetzt: Touch-Handling, Achsen-Lock, Positionsberechnung, Feder-Animation,
Gummiband, Momentum-Projektion, Wheel-Handler und Maus-Drag.

**`scroll-snap-stop: always` ersetzt die ±1-Klemme aus D** — der Browser kann
dann ebenfalls nicht mehr über Kacheln hinwegfliegen.

---

## 5. Schritte

> *Ursprünglicher Plan. Umgesetzt mit den Abweichungen aus Abschnitt 0.*

1. **Slides umbauen:** absolut positionierte, per `transform` bewegte Slides →
   normale, im Fluss stehende Kinder eines scrollbaren Containers.
2. **`currentIndex` ermitteln:** `IntersectionObserver` mit `threshold: 0.5` auf
   jede Kachel. Bewusst *kein* `scroll`-Event — das feuert auf dem Haupt-Thread
   und würde den Vorteil teilweise wieder aufgeben.
3. **`settledIndex` ermitteln:** `scrollend`-Event, mit Debounce-Fallback (siehe
   Fallstrick 3). Video-Fenster (A2) bleibt daran hängen.
4. **`snapTo(i)` ersetzen:** `el.scrollIntoView({ behavior: "smooth", block: "start" })`
   bzw. `container.scrollTo({ top: i * h, behavior: "smooth" })`.
5. **`realign(i)` ersetzen:** dasselbe ohne `behavior: "smooth"`.
6. **Swipe-Follow retten:** siehe Fallstrick 1 — das ist der eigentliche Knackpunkt.
7. **Choreografien umstellen:** siehe Fallstrick 2.
8. Aufräumen: toter Code (Abschnitt 7).

---

## 6. Fallstricke

### 1. Swipe-Follow neben nativem Scrollen — der Knackpunkt

Folgen passiert per Rechts-Wisch auf der Kachel (`use-swipe-follow.ts`), Entfolgen
per Links-Wisch. Bisher entscheidet ein selbstgebauter Achsen-Lock in
`use-snap-scroll.ts`, ob eine Geste scrollt oder folgt.

**Lösung:** `touch-action: pan-y` auf der Kachel. Damit übernimmt der Browser die
vertikale Achse nativ, und horizontale Gesten kommen weiterhin bei JavaScript an.
Der gesamte Achsen-Lock entfällt — der Browser macht ihn selbst, und zwar besser.

> **Achtung:** Der heutige Code ruft in `onMove` **`e.preventDefault()`** bei jeder
> Geste auf der Feed-Achse und hängt die Listener mit `{ passive: false }` ans
> `window`. Genau das muss weg — sonst blockiert es das native Scrollen, das man
> gerade gewinnen will. Der Container braucht außerdem `touch-action: auto` statt
> des heutigen `touchAction: "none"` (`discovery-feed.tsx`, Container-`div`).

### 2. Die Choreografien hängen an einer festen Dauer

`discovery-feed.tsx:187` und `following-feed.tsx:282` timen beide mit
`SWIPE_EXIT_MS + SNAP_MS + 60`: Kachel fliegt raus → `snapTo(i+1)` → Kachel aus
der Liste nehmen → `realign(i)` im selben Tick.

Bei nativem Smooth-Scroll ist die Dauer **nicht mehr vorhersagbar** (sie hängt von
Gerät und Systemeinstellung ab). Diese Ketten müssen auf das `scrollend`-Ereignis
umgestellt werden statt auf einen Timer.

> `SNAP_MS` darf bis dahin **nur nach oben** verändert werden. Wird es auf die
> typische Dauer heruntergezogen, funkt `realign` in eine noch laufende Bewegung
> und der Feed springt beim Folgen und Entfolgen.

### 3. `scrollend` ist relativ neu

Safari unterstützt `scrollend` erst in neueren Versionen. Es braucht einen
Fallback: `scroll`-Event mit ~100 ms Debounce, oder ein `IntersectionObserver`,
der prüft, ob eine Kachel stabil im Blick liegt. Vor dem Bauen am Zielgerät
prüfen — die Pilot-Geräte sind iPhones.

### 4. Element entfernen, während gescrollt wird

Nach einem Follow verschwindet die Kachel aus der Liste. Bei absoluten Slides war
das unsichtbar (`realign`). Bei nativem Scrollen verschiebt das Entfernen den
Inhalt **über** der aktuellen Position und damit das Bild.

Gegenmittel: `overflow-anchor` (Scroll-Anchoring) prüfen, oder `scrollTop` im
selben Frame nachziehen, in dem das Element entfernt wird.

### 5. Alle Kacheln müssen exakt gleich hoch sein

`scroll-snap-type: mandatory` verhält sich unangenehm, wenn Elemente
unterschiedlich hoch sind. Der Container ist `h-dvh` und ändert seine Höhe, wenn
die Browser-Leiste ein- und ausfährt — die Kacheln müssen zwingend mitgehen
(`height: 100%`, nicht `100vh`).

### 6. Bonus: Backlog #23 erledigt sich vermutlich mit

„Beim Zurückgehen auf Stadt klebt der Feed zwischen zwei Momenten." Vermutete
Ursache (von `corso-ephy-83`): React hängt Refs von innen nach außen, `slideRef`
läuft vor `containerRef`, `getDim()` fällt in dem Moment auf `window.innerHeight`
zurück, während das Layout `h-dvh` ist — auf dem Handy driftet das um die Höhe der
Browser-Leiste auseinander.

**Beim nativen Scrollen gibt es kein `getDim()` mehr.** Die Fehlerklasse
verschwindet mit der Ursache. Nach dem Umbau gegenprüfen, ob #23 noch auftritt.

### 7. Was der Umbau *nicht* löst

**Video-Dekodierung.** Wenn mehrere `<video>` gleichzeitig dekodieren, kostet das
weiterhin Leistung — es blockiert dann aber nicht mehr die Scroll-Bewegung,
sondern nur noch die Bildwiedergabe. Das Video-Fenster (A2) bleibt deshalb wichtig
und sollte auf `following-feed.tsx` und `story.tsx` ausgeweitet werden, die bis
heute **alle** Videos gleichzeitig mounten.

**Haptik beim Wischen auf dem iPhone.** Naheliegende Hoffnung: Der Umbau entfernt
`preventDefault`, dadurch könnte ein natives Schalter-Element in der Kachel den
System-Tap auslösen und Swipe-Follow bekäme endlich haptisches Feedback. **Das
funktioniert nicht** — am 4. September 2026 von `corso-ephy-8d` auf Dominiks Gerät
gemessen, mit vier Flächen mit unsichtbarem Switch-Element:

| Geste | Impuls |
|-------|--------|
| quer gewischt | ✗ |
| quer gewischt, während die Kachel dem Finger folgt | ✗ |
| hoch/runter gewischt | ✗ |
| getippt | ✓ |

Ein iOS-Switch lässt sich zwar nativ ziehen, aber nur der echte **Tipp** erzeugt
einen System-Tap. Es scheitert also an iOS, nicht am Scroll-Code — der Umbau
ändert daran nichts. Details in `src/lib/haptics.ts`.

Nachprüfbar ohne Setup und ohne Build: Die Diagnose-Seiten liegen statisch in
`public/assets/` und sind live erreichbar (extensionslos, `.html` leitet per 308
um):

- `/assets/haptik-test` · `/assets/haptik-test2` — Tipp-Ziele
- `/assets/haptik-test3` — **die Wisch-Messung aus der Tabelle oben**, bewusst
  ohne `use-snap-scroll`

Nach einem größeren iOS-Update dort einmal durchwischen. Ändert sich das Ergebnis,
gilt die Tabelle nicht mehr.

---

## 7. Was wegfallen kann

> *Erledigt am 16. Sep: 726 → 451 Zeilen. Das „Viertel" war zu optimistisch —
> Swipe-Gesten, Tipp und das Festhalten der Kachel sind im Hook geblieben.*

`use-snap-scroll.ts` hatte damals **688 Zeilen**. Nach dem Umbau bleibt davon
schätzungsweise ein Viertel — im Wesentlichen Index-Ermittlung und das
Video-Fenster.

Ersatzlos streichbar:

- Touch-Handler samt Achsen-Lock, Velocity-Historie und Momentum-Projektion
- Feder-Animation, Gummiband, `applyPos`, `paintedRef`, `RENDER_WINDOW`
- Wheel-Handler (nativ)
- **Der komplette `axis: "x"`-Pfad ist bereits heute toter Code.** Alle vier
  Aufrufer — `discovery-feed.tsx:209`, `following-feed.tsx:289`, `story.tsx:326`,
  `circle.tsx:157` — nutzen die vertikale Achse. Der Parameter kann samt
  Maus-Drag-Effekt für „Stadt Corso auf Desktop" entfallen.
- `visibilitychange`-Sicherheitsnetz für abgebrochene Gesten (kein eigenes
  Gesten-Handling mehr)

`use-swipe-follow.ts` (132 Zeilen) bleibt, wird aber einfacher: Es bekommt seine
horizontalen Gesten dann direkt statt über den Umweg `onSwipeX`.

---

## 8. Risiken

- **Es fasst die zentrale Interaktion der App an.** Discovery, Ich folge, Stadt
  Corso und Circle hängen alle am selben Hook. Ein Fehler betrifft sofort alles.
- **Swipe-Follow ist die riskanteste Stelle.** Wenn `touch-action: pan-y` auf dem
  Ziel-iPhone nicht sauber trennt, muss die Interaktion neu gedacht werden — und
  Folgen per Wisch ist eine bewusste Produktentscheidung (2. Sep 2026), kein
  Detail.
- **Nicht auf dem Desktop testen.** Der Unterschied ist am Mac praktisch
  unsichtbar. Nur das iPhone zählt.

---

## 9. Testen

> *Ergebnis der Abnahme vom 16. Sep: Abschnitt 0.*

Erst sinnvoll, wenn genug Momente im Feed liegen — realistisch **nach 21:00**,
wenn die Pilot-Gruppe gepostet hat. Mit zwei, drei Kacheln lässt sich Scrollen
nicht beurteilen.

1. Tief durch Discovery wischen, besonders an der Nachlade-Grenze (~alle 20 Kacheln).
2. Rechts-Wisch zum Folgen: Trennt der Browser sauber zwischen Scrollen und Folgen?
3. Nach dem Folgen: Springt der Feed? (Fallstrick 4)
4. Von Stadt weg navigieren und zurück: klebt es zwischen zwei Momenten? (#23)
5. Ehrlicher Vergleich gegen TikTok/Instagram auf demselben Gerät.

Messen statt raten: Safari Web Inspector am Mac, iPhone per Kabel, Timeline
aufzeichnen. Interessant ist, ob während des Wischens noch Haupt-Thread-Arbeit
anfällt.

---

## 10. Aufwand

Grobe Schätzung: **mehrere Stunden plus Testrunden am Gerät**, davon der größte
Teil in Swipe-Follow (Fallstrick 1) und den Choreografien (Fallstrick 2). Der
CSS-Teil selbst ist klein.

Sinnvoll in einer Sitzung mit Zugang zum iPhone und gefülltem Feed — nicht
zwischendurch.

---

## 11. Vor dem Start beachten

> *Gilt für jede weitere Änderung an den Feeds genauso.*

Am Repo arbeiten regelmäßig **mehrere Claude-Sessions parallel**. Vor Änderungen
an `use-snap-scroll.ts`, den Feeds oder `use-swipe-follow.ts` per `ListAgents`
prüfen, wer sonst aktiv ist, und den Datei-Besitz per `SendMessage` aushandeln.
`scripts/deploy.sh` baut den **gemeinsamen** Working Tree — fremde unfertige
Arbeit geht sonst ungefragt mit live.
