## Countdown als Intro-Screen

Der Countdown wird als allererster Full-Screen vor die Bild-Story gesetzt. Man tappt/swiped ihn weg und landet im ersten Bild.

### Umsetzung in `src/routes/index.tsx`

1. `useCountdown` Hook wieder hinzufügen (Ziel-Datum wie vorher).
2. Story-Array um einen neuen ersten "Slide" vom Typ `countdown` erweitern — die bestehende Slide-Logik (Fade nach oben beim Wechsel, Tap/Swipe Navigation, Progress-Bars oben rechts) funktioniert dadurch automatisch auch für den Countdown.
3. Render-Logik: wenn aktiver Slide Typ `countdown` ist, wird statt `<img>` ein zentrierter Countdown gerendert (große Zahlen `DD : HH : MM : SS`, darunter kleines Label).
4. Styling: gleicher abgerundeter Rahmen wie die Bild-Slides (konsistenter Look), dezenter dunkler Hintergrund mit subtilem Gradient, große Typo mittig.
5. Auto-Advance: Countdown-Slide bekommt etwas längere Anzeigedauer (z.B. 6s) bevor automatisch zum ersten Bild weitergefadet wird — User kann auch tappen.
6. Control-Panel unten und rechte Bar bleiben unverändert sichtbar.

Keine weiteren Dateien betroffen.