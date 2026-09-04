import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

// Grobe Dauer einer Einrast-Bewegung. Seit der Umstellung auf die Feder unten
// ist das KEINE exakte Animationsdauer mehr — die Feder ist mal schneller
// (harter Flick), mal langsamer (sanftes Loslassen). Der Wert bleibt als
// großzügige OBERGRENZE für Aufrufer, die eine Choreografie an den Snap hängen:
// discovery-feed.tsx (Folgen) und following-feed.tsx (Entfolgen) warten damit
// über `SWIPE_EXIT_MS + SNAP_MS + 60` ab, bis der Feed steht, bevor sie die
// Kachel aus der Liste nehmen und per `realign` den Index nachziehen.
//
// Deshalb darf der Wert nur nach OBEN korrigiert werden. Wer ihn auf die neue
// typische Dauer heruntersetzt, lässt `realign` in eine noch laufende Feder
// funken — der Feed springt dann beim Folgen und Entfolgen.
export const SNAP_MS = 380;

// Das Einrasten läuft als kritisch gedämpfte Feder statt als Kurve mit fester
// Dauer. Der Unterschied ist genau das, was man als „flüssig" empfindet: Die
// Bewegung übernimmt die Geschwindigkeit, mit der der Finger losgelassen hat,
// statt bei jedem Wisch dieselbe Zeit abzuwarten. Ein harter Flick rastet
// dadurch schnell ein, ein sanftes Schubsen läuft weich aus.
//
// `SPRING_DAMPING` ist bewusst aus der Härte abgeleitet (2·√k) und keine freie
// Zahl: Genau dieser Wert ist die Grenze, an der die Kachel so schnell wie
// möglich in ihre Endlage läuft, ohne darüber hinauszuschießen. Ein Feed, der
// am Ende nachwippt, wirkt billig — wer hier schraubt, sollte die Kopplung
// beibehalten und nur `SPRING_STIFFNESS` anfassen.
//
// Die Härte ist nicht geraten, sondern durchgerechnet (bei 800 px Kachelhöhe,
// 60 fps, Weg = halbe Kachel). „Sichtbar" = bis 90 % der Strecke zurückgelegt
// sind, danach kriecht die Feder nur noch unmerklich:
//
//     Härte    sichtbar    bis Stillstand
//       260      250 ms          667 ms
//       600      167 ms          467 ms
//       800      150 ms          417 ms   ← gewählt
//      1400      117 ms          333 ms
//
// Die alte Kurve mit fester Dauer war nach rund 230 ms optisch fertig. 260 wäre
// also spürbar TRÄGER gewesen als der Zustand davor — genau das, was hier
// abgestellt werden sollte. 800 ist merklich direkter als vorher und bleibt
// durch die kritische Dämpfung trotzdem weich.
const SPRING_STIFFNESS = 800;
const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS);
// Ab hier gilt die Bewegung als beendet. Ein Pixel Restabstand ist auf keinem
// Display zu sehen — enger abzubrechen kostet nur Frames und verzögert das
// Nachladen des Video-Fensters.
const SPRING_REST_PX = 1;
const SPRING_REST_VELOCITY = 40; // px/s

// Zähigkeit des Gummibands an den Feed-Rändern. Kleiner = härterer Anschlag.
const RUBBER_TENSION = 0.55;

/**
 * Widerstand jenseits des ersten/letzten Moments. Ohne ihn folgt der Rand dem
 * Finger 1:1 ins Leere und schnappt hart zurück — das fühlt sich nach Fehler an,
 * nicht nach Grenze. Die Dämpfung ist progressiv: die ersten Pixel gehen fast
 * frei, danach wird es zäh und läuft asymptotisch gegen einen festen Anschlag,
 * egal wie weit man zieht.
 */
function rubberBand(overflow: number, dim: number) {
  const sign = overflow < 0 ? -1 : 1;
  const ratio = Math.abs(overflow) / dim;
  return sign * (1 - 1 / (ratio * RUBBER_TENSION + 1)) * dim;
}

// Ab dieser Fingerbewegung (px) entscheidet sich die Achse einer Geste.
const AXIS_LOCK_SLOP = 10;

// So viele Slides um die aktuelle Position herum werden pro Frame tatsächlich
// bewegt. Alles darüber hinaus steht ohnehin außerhalb des Bildschirms — es in
// jedem Frame mitzuschreiben kostete in einem lang gescrollten Discovery-Feed
// hunderte Style-Writes, von denen niemand etwas sieht.
const RENDER_WINDOW = 3;

/**
 * Quer zur Feed-Achse wischen (Swipe-Follow): Der Feed meldet die horizontale
 * Geste an den Aufrufer, statt sie zu schlucken. Die ERSTE eindeutige
 * Bewegungsrichtung sperrt die Geste auf ihre Achse — ein Wisch ist entweder
 * Scrollen ODER Folgen, nie beides gleichzeitig (kein Zittern unterm Finger).
 */
export interface SwipeXHandlers {
  /** Finger bewegt sich horizontal — dx relativ zum Gestenstart (px, rechts > 0). */
  move: (index: number, dx: number) => void;
  /** Geste beendet — dx final, velocityX in px/ms (rechts > 0). */
  end: (index: number, dx: number, velocityX: number) => void;
}

/**
 * Physik-basiertes Snap-Scroll: Bild folgt direkt dem Finger,
 * nach dem Loslassen schnappt es mit RAF + easeOutCubic ein.
 */
export function useSnapScroll({
  count,
  axis = "y",
  onSwipeX,
}: {
  count: number;
  axis?: "x" | "y";
  /** Nur für axis "y" ausgewertet: horizontale Wisch-Gesten (Swipe-Follow). */
  onSwipeX?: SwipeXHandlers;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  // Zwei Indizes, bewusst getrennt:
  //  - `currentIndex` wechselt SOFORT beim Überqueren der Slide-Hälfte. Daran
  //    hängt, welcher Moment spielt — das muss ohne Verzögerung passieren.
  //  - `settledIndex` zieht erst nach, wenn die Bewegung wirklich steht. Daran
  //    gehören die teuren Entscheidungen: welche <video>-Elemente überhaupt im
  //    DOM sind. Vorher hing beides am selben Wert, das Video-Fenster wanderte
  //    also mitten in der Wischgeste mit und React montierte/demontierte
  //    <video>-Elemente im laufenden Frame — genau dort verschluckte sich die
  //    Animation.
  const [settledIndex, setSettledIndex] = useState(0);
  const indexRef = useRef(0);
  // Weltposition in Pixeln: indexRef.current * Bildschirmhöhe/-breite
  const posRef = useRef(0);
  const slidesRef = useRef<(HTMLElement | null)[]>([]);
  // 0 = keine Snap-Animation läuft. Wird am Animationsende zurückgesetzt, damit
  // Effekte unterscheiden können, ob sie in eine Bewegung hineinfunken würden.
  const rafRef = useRef(0);
  // Finger (oder Maus) liegt gerade auf dem Feed.
  const gestureRef = useRef(false);
  // Stabile Callback-Refs pro Slide-Index — verhindert React-Re-Registration bei Re-Render
  const callbacksRef = useRef<((el: HTMLElement | null) => void)[]>([]);
  // Der Feed-Container. Die Gesten-Listener hängen aus Robustheitsgründen weiter am
  // window (der Container kann später mounten), werden aber darauf eingegrenzt, ob
  // die Geste IM Container beginnt. Ohne das steuert jeder Wisch irgendwo auf der
  // Seite den Feed — auch einer auf einem Overlay darüber (Tages-Prompt-Splash).
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Slide-Zahl als Ref. Dadurch bleiben `clampIndex` und `snapTo` über die ganze
  // Sitzung dieselben Funktionen — und damit auch die Gesten-Effekte, die daran
  // hängen. Vorher hing `clampIndex` direkt an `count`: Jede nachgeladene Seite
  // und jeder Follow registrierte die Touch-Listener neu. Der Gesten-Zustand
  // (gestureActive, history, startWorldPos) lebt aber in deren Closure, ging
  // dabei verloren, und der Feed hörte mitten im Wischen auf, dem Finger zu
  // folgen — ohne abschließenden Snap.
  const countRef = useRef(count);
  countRef.current = count;
  // Zuletzt bewegter Slide-Bereich. Was daraus herausfällt, wird EINMAL
  // stillgelegt statt in jedem Frame neu beschrieben.
  const paintedRef = useRef({ lo: 0, hi: -1 });

  // Geste zählt nur, wenn sie im Feed beginnt. Kein Container gesetzt → wie bisher.
  const isInsideContainer = useCallback((target: EventTarget | null) => {
    const el = containerRef.current;
    if (!el) return true;
    return target instanceof Node && el.contains(target);
  }, []);

  // Maß aus dem Container, nicht aus window.innerHeight: der Container ist `h-dvh`
  // und folgt damit der ein-/ausfahrenden Browser-Leiste auf dem Handy. innerHeight
  // driftet dagegen auseinander → Slides säßen um die Leistenhöhe versetzt.
  const getDim = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      const measured = axis === "y" ? el.clientHeight : el.clientWidth;
      if (measured > 0) return measured;
    }
    return axis === "y" ? window.innerHeight : window.innerWidth;
  }, [axis]);

  const applyPos = useCallback(
    (pos: number) => {
      const dim = getDim();
      const tr = axis === "y" ? "Y" : "X";
      const slides = slidesRef.current;
      const center = Math.round(pos / dim);
      const lo = Math.max(0, center - RENDER_WINDOW);
      const hi = Math.min(slides.length - 1, center + RENDER_WINDOW);

      // Was aus dem Fenster gefallen ist, einmal stilllegen: aus dem Paint
      // nehmen und die Compositor-Ebene freigeben. `will-change` dauerhaft auf
      // jedem Slide eines langen Feeds zu lassen kostet auf iOS mehr Speicher,
      // als es an Glätte bringt.
      const prev = paintedRef.current;
      for (let i = prev.lo; i <= prev.hi; i++) {
        if (i >= lo && i <= hi) continue;
        const el = slides[i];
        if (!el) continue;
        el.style.visibility = "hidden";
        el.style.willChange = "";
      }

      for (let i = lo; i <= hi; i++) {
        const el = slides[i];
        if (!el) continue;
        const offset = i * dim - pos;
        el.style.transform = `translate${tr}(${offset}px)`;
        if (el.style.visibility === "hidden") {
          el.style.visibility = "";
          el.style.willChange = "transform";
        }
      }

      paintedRef.current = { lo, hi };
    },
    [axis, getDim],
  );

  // Aktiven Index übernehmen. Bewusst SOFORT und nicht erst am Ende der
  // Snap-Animation: `currentIndex` steuert, welches Video spielt (isActive).
  // Wurde er erst am Animationsende gesetzt, lief während des ganzen Wischens
  // noch der alte Moment weiter, während der neue eingefroren stehenblieb.
  const commitIndex = useCallback((idx: number) => {
    if (indexRef.current === idx) return;
    indexRef.current = idx;
    haptic("tick");
    setCurrentIndex(idx);
  }, []);

  const clampIndex = useCallback(
    (idx: number) => Math.max(0, Math.min(countRef.current - 1, idx)),
    [],
  );

  /**
   * Zum Einrastpunkt federn. `velocityPxPerS` ist die Geschwindigkeit, mit der
   * der Finger losgelassen hat (positiv = in Richtung wachsender Position) — sie
   * geht als Anfangsgeschwindigkeit in die Feder ein, damit die Bewegung den
   * Schwung der Geste fortsetzt statt bei null neu anzufangen.
   */
  const snapTo = useCallback(
    (rawIdx: number, velocityPxPerS = 0) => {
      const targetIdx = clampIndex(rawIdx);
      const targetPos = targetIdx * getDim();

      cancelAnimationFrame(rafRef.current);
      // Ziel sofort aktiv schalten — das Video des Ziel-Slides startet mit der
      // Bewegung, nicht erst wenn sie steht.
      commitIndex(targetIdx);

      let velocity = velocityPxPerS;
      let last = performance.now();

      const animate = (now: number) => {
        // Zeitschritt deckeln. Nach einem verschluckten Frame — oder wenn der
        // Browser die Seite kurz pausiert hat — würde ein großer Sprung die
        // Feder aufschaukeln statt sie zu beruhigen.
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;

        const offset = posRef.current - targetPos;
        velocity += (-SPRING_STIFFNESS * offset - SPRING_DAMPING * velocity) * dt;
        posRef.current += velocity * dt;
        applyPos(posRef.current);

        if (
          Math.abs(posRef.current - targetPos) > SPRING_REST_PX ||
          Math.abs(velocity) > SPRING_REST_VELOCITY
        ) {
          rafRef.current = requestAnimationFrame(animate);
          return;
        }

        // Endposition frisch messen: fährt die Browser-Leiste WÄHREND der Animation
        // ein oder aus, stimmt das eingangs berechnete Ziel nicht mehr — der Feed
        // bliebe sonst um die Leistenhöhe versetzt zwischen zwei Momenten stehen.
        const finalPos = targetIdx * getDim();
        posRef.current = finalPos;
        applyPos(finalPos);
        rafRef.current = 0;
        // Erst jetzt steht die Bewegung — ab hier darf der Feed die teure
        // Arbeit nachholen (Video-Fenster verschieben).
        setSettledIndex(targetIdx);
      };

      rafRef.current = requestAnimationFrame(animate);
    },
    [clampIndex, getDim, applyPos, commitIndex],
  );

  // Position mit Rand-Widerstand. Innerhalb des Feeds unverändert, jenseits von
  // erstem/letztem Moment gedämpft.
  const withRubberBand = useCallback(
    (pos: number) => {
      const dim = getDim();
      const max = Math.max(0, (countRef.current - 1) * dim);
      if (pos < 0) return rubberBand(pos, dim);
      if (pos > max) return max + rubberBand(pos - max, dim);
      return pos;
    },
    [getDim],
  );

  // Slide-Zahl hat sich geändert: Seite nachgeladen, Kachel nach Follow verschwunden,
  // Leerzustand → echte Momente. Drei Fälle:
  //  - Index zeigt ins Leere (letzte Kachel weg) → auf die neue letzte schnappen,
  //    sonst stünde man vor einem leeren Slot.
  //  - Geste oder Snap läuft → NUR die neuen Slides einsortieren, Position nicht
  //    anfassen. Ein Reset auf index*dim ließ den Feed unter dem Finger springen,
  //    wenn die nächste Seite mitten im Wischen eintraf.
  //  - Ruhe → Position sauber auf den Index setzen.
  useEffect(() => {
    const clamped = Math.max(0, Math.min(count - 1, indexRef.current));
    if (clamped !== indexRef.current) {
      snapTo(clamped);
      return;
    }
    if (!gestureRef.current && rafRef.current === 0) {
      posRef.current = indexRef.current * getDim();
    }
    applyPos(posRef.current);
  }, [count, getDim, applyPos, snapTo]);

  // Größenänderung: Orientierung, aber vor allem die ein-/ausfahrende Browser-Leiste
  // auf dem Handy. Der ResizeObserver am Container erwischt das zuverlässiger als
  // `resize` am window, weil `h-dvh` sich ändert, ohne dass window feuern muss.
  useEffect(() => {
    const onResize = () => {
      posRef.current = indexRef.current * getDim();
      applyPos(posRef.current);
    };
    window.addEventListener("resize", onResize);

    const el = containerRef.current;
    const observer =
      el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    observer?.observe(el!);

    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [getDim, applyPos]);

  // Swipe-X-Handler in einem Ref spiegeln: die Gesten-Listener bleiben stabil
  // gebunden, auch wenn der Aufrufer die Callbacks pro Render neu erzeugt.
  const swipeXRef = useRef<SwipeXHandlers | undefined>(onSwipeX);
  swipeXRef.current = onSwipeX;

  // Touch: Finger folgt direkt, Velocity-Projektion beim Loslassen.
  // Achsen-Lock: die erste eindeutige Bewegungsrichtung entscheidet, ob die
  // Geste den Feed scrollt (Feed-Achse) oder als Quer-Wisch (Swipe-Follow) an
  // onSwipeX geht — danach wechselt die Geste die Achse nicht mehr.
  useEffect(() => {
    let startTouchPos = 0;
    let startCrossPos = 0;
    let startWorldPos = 0;
    let swipeIndex = 0;
    let axisLock: "none" | "main" | "cross" = "none";
    let history: { pos: number; t: number }[] = [];
    let gestureActive = false;

    const getPos = (e: TouchEvent) => (axis === "y" ? e.touches[0].clientY : e.touches[0].clientX);
    const getCross = (e: TouchEvent) =>
      axis === "y" ? e.touches[0].clientX : e.touches[0].clientY;

    const onStart = (e: TouchEvent) => {
      // Nur Gesten, die im Feed beginnen. Ein Wisch auf einem Overlay darüber
      // (z.B. dem Tages-Prompt-Splash) darf den Feed nicht fernsteuern.
      if (!isInsideContainer(e.target)) {
        gestureActive = false;
        gestureRef.current = false;
        return;
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      gestureActive = true;
      gestureRef.current = true;
      axisLock = "none";
      startTouchPos = getPos(e);
      startCrossPos = getCross(e);
      startWorldPos = posRef.current;
      // Der Quer-Wisch gilt für den Slide, auf dem die Geste BEGINNT — auch wenn
      // der aktive Index währenddessen theoretisch wechseln könnte.
      swipeIndex = indexRef.current;
      const now = performance.now();
      history = [{ pos: startTouchPos, t: now }];
    };

    const onMove = (e: TouchEvent) => {
      if (!gestureActive) return;
      e.preventDefault();
      const now = performance.now();
      const cur = getPos(e);
      const cross = getCross(e);

      // Achse noch offen → bei genug Bewegung festlegen. Quer gewinnt nur, wenn
      // ein onSwipeX-Handler da ist (sonst bleibt alles wie bisher vertikal).
      if (axisLock === "none") {
        const dMain = Math.abs(cur - startTouchPos);
        const dCross = Math.abs(cross - startCrossPos);
        if (Math.max(dMain, dCross) < AXIS_LOCK_SLOP) return;
        axisLock = dCross > dMain && swipeXRef.current ? "cross" : "main";
        if (axisLock === "cross") {
          // Vertikale Startbewegung (unter dem Slop) zurücknehmen — der Feed
          // bleibt exakt auf seinem Einrastpunkt stehen.
          posRef.current = startWorldPos;
          applyPos(posRef.current);
          history = [{ pos: cross, t: now }];
        }
      }

      if (axisLock === "cross") {
        history.push({ pos: cross, t: now });
        const cutoff = now - 100;
        while (history.length > 1 && history[0].t < cutoff) history.shift();
        swipeXRef.current?.move(swipeIndex, cross - startCrossPos);
        return;
      }

      history.push({ pos: cur, t: now });
      // Nur letzten 100ms behalten
      const cutoff = now - 100;
      while (history.length > 1 && history[0].t < cutoff) history.shift();
      // Bild folgt Finger in Echtzeit — an den Rändern mit Widerstand, damit
      // der erste und letzte Moment eine spürbare Grenze haben.
      posRef.current = withRubberBand(startWorldPos + (startTouchPos - cur));
      applyPos(posRef.current);
      // Aktiven Slide schon beim Überqueren der Hälfte wechseln — der Moment,
      // auf den man zieht, spielt dann bereits, statt eingefroren zu warten.
      commitIndex(clampIndex(Math.round(posRef.current / getDim())));
    };

    const onEnd = (e: TouchEvent) => {
      if (!gestureActive) return;
      gestureActive = false;
      gestureRef.current = false;

      if (axisLock === "cross") {
        const endCross = axis === "y" ? e.changedTouches[0].clientX : e.changedTouches[0].clientY;
        let velocityPxMs = 0;
        if (history.length >= 2) {
          const oldest = history[0];
          const newest = history[history.length - 1];
          const dt = newest.t - oldest.t;
          if (dt > 0) velocityPxMs = (newest.pos - oldest.pos) / dt;
        }
        swipeXRef.current?.end(swipeIndex, endCross - startCrossPos, velocityPxMs);
        return;
      }

      // Velocity aus Zeitfenster berechnen
      let velocityPxMs = 0;
      if (history.length >= 2) {
        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = newest.t - oldest.t;
        if (dt > 0) velocityPxMs = (oldest.pos - newest.pos) / dt;
      }

      const dim = getDim();
      // Wo läge man ohne Schwung — und wohin trüge der Schwung (150 ms Projektion)?
      const restIdx = Math.round(posRef.current / dim);
      const projectedIdx = Math.round((posRef.current + velocityPxMs * 150) / dim);
      // Der Schwung darf höchstens EINEN Moment weitertragen. Ohne die Klemme
      // überspringt ein harter Flick zwei oder drei Momente, die man nie zu
      // sehen bekommt — der Feed fühlt sich dann unkontrollierbar an. Gedämpft
      // wird nur das Momentum: Wer den Finger langsam über mehrere Kacheln
      // zieht, landet weiterhin dort, wo er hingezogen hat.
      const targetIdx = Math.max(restIdx - 1, Math.min(restIdx + 1, projectedIdx));
      // Geschwindigkeit in px/s an die Feder übergeben, damit die Bewegung ohne
      // sichtbaren Knick aus der Geste in die Animation übergeht.
      snapTo(targetIdx, velocityPxMs * 1000);
    };

    const abortSwipeX = () => {
      // Quer-Geste abgebrochen → Karte zurückfedern lassen (dx 0, keine Velocity).
      swipeXRef.current?.end(swipeIndex, 0, 0);
    };

    const onCancel = () => {
      if (!gestureActive) return;
      gestureActive = false;
      gestureRef.current = false;
      if (axisLock === "cross") {
        abortSwipeX();
        return;
      }
      snapTo(indexRef.current);
    };

    // Sicherheitsnetz: Geht die App mitten in der Geste in den Hintergrund
    // (Home-Geste, Anruf, App-Wechsel), kommt auf iOS nicht immer ein touchend
    // oder touchcancel an. Ohne Snap bliebe der Feed genau dort stehen, wo der
    // Finger war — zwischen zwei Momenten. Deshalb hier auf den nächsten
    // Einrastpunkt schnappen.
    const onHidden = () => {
      if (document.visibilityState !== "hidden" || !gestureActive) return;
      gestureActive = false;
      gestureRef.current = false;
      if (axisLock === "cross") {
        abortSwipeX();
        return;
      }
      snapTo(Math.round(posRef.current / getDim()));
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [axis, getDim, applyPos, snapTo, isInsideContainer, commitIndex, clampIndex, withRubberBand]);

  // Trackpad / Mausrad
  useEffect(() => {
    let snapId: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      if (!isInsideContainer(e.target)) return;
      e.preventDefault();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      const delta = axis === "x" ? e.deltaX || e.deltaY : e.deltaY;
      posRef.current = withRubberBand(posRef.current + delta);
      applyPos(posRef.current);
      if (snapId) clearTimeout(snapId);
      snapId = setTimeout(() => {
        const dim = getDim();
        snapTo(Math.round(posRef.current / dim));
        snapId = null;
      }, 150);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (snapId) clearTimeout(snapId);
    };
  }, [axis, getDim, applyPos, snapTo, isInsideContainer, withRubberBand]);

  // Maus-Drag für den Quer-Wisch (Swipe-Follow) auf Desktop: ohne Folgen-Button
  // wäre Folgen mit der Maus sonst unmöglich. Vertikales Maus-Ziehen bleibt wie
  // bisher ohne Funktion (Scrollen am Desktop läuft über das Mausrad).
  useEffect(() => {
    if (axis !== "y") return;
    let tracking = false;
    let lock: "none" | "cross" | "dead" = "none";
    let startX = 0;
    let startY = 0;
    let swipeIndex = 0;
    let history: { pos: number; t: number }[] = [];

    const onDown = (e: MouseEvent) => {
      if (!swipeXRef.current) return;
      if (!isInsideContainer(e.target)) return;
      tracking = true;
      lock = "none";
      startX = e.clientX;
      startY = e.clientY;
      swipeIndex = indexRef.current;
      history = [{ pos: e.clientX, t: performance.now() }];
    };
    const onMove = (e: MouseEvent) => {
      if (!tracking) return;
      if (lock === "none") {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (Math.max(dx, dy) < AXIS_LOCK_SLOP) return;
        lock = dx > dy ? "cross" : "dead";
      }
      if (lock !== "cross") return;
      e.preventDefault();
      const now = performance.now();
      history.push({ pos: e.clientX, t: now });
      const cutoff = now - 100;
      while (history.length > 1 && history[0].t < cutoff) history.shift();
      swipeXRef.current?.move(swipeIndex, e.clientX - startX);
    };
    const onUp = (e: MouseEvent) => {
      if (!tracking) return;
      tracking = false;
      if (lock !== "cross") return;
      let velocityPxMs = 0;
      if (history.length >= 2) {
        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = newest.t - oldest.t;
        if (dt > 0) velocityPxMs = (newest.pos - oldest.pos) / dt;
      }
      swipeXRef.current?.end(swipeIndex, e.clientX - startX, velocityPxMs);
    };

    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, isInsideContainer]);

  // Maus-Drag horizontal für Stadt Corso auf Desktop
  useEffect(() => {
    if (axis !== "x") return;
    let startX = 0;
    let startWorldPos = 0;
    let tracking = false;
    let lastTouchEnd = 0;

    const onTouchEnd = () => {
      lastTouchEnd = Date.now();
    };
    const onDown = (e: MouseEvent) => {
      if (Date.now() - lastTouchEnd < 600) return;
      if (!isInsideContainer(e.target)) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      startX = e.clientX;
      startWorldPos = posRef.current;
      tracking = true;
      gestureRef.current = true;
    };
    const onMove = (e: MouseEvent) => {
      if (!tracking) return;
      posRef.current = withRubberBand(startWorldPos + (startX - e.clientX));
      applyPos(posRef.current);
    };
    const onUp = () => {
      if (!tracking) return;
      tracking = false;
      gestureRef.current = false;
      if (Date.now() - lastTouchEnd < 600) {
        snapTo(indexRef.current);
        return;
      }
      snapTo(Math.round(posRef.current / getDim()));
    };

    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, getDim, applyPos, snapTo, isInsideContainer, withRubberBand]);

  // Index + Position OHNE Animation hart setzen. Für den unsichtbaren Umbau nach
  // einem Swipe-Follow: erst scrollt der Feed animiert zum nächsten Moment
  // (snapTo), dann wird die gefolgte Kachel aus der Liste genommen — alle
  // nachfolgenden Slides rücken einen Index auf, der sichtbare Moment ist aber
  // derselbe. realign() zieht Index/Position im selben Tick nach, damit der
  // Frame identisch bleibt (kein Sprung, kein zweiter Scroll).
  const realign = useCallback(
    (idx: number) => {
      const clamped = clampIndex(idx);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      indexRef.current = clamped;
      posRef.current = clamped * getDim();
      applyPos(posRef.current);
      setCurrentIndex(clamped);
      // Harte Neuausrichtung heißt: die Bewegung ist vorbei.
      setSettledIndex(clamped);
    },
    [clampIndex, getDim, applyPos],
  );

  // Stabile Callback-Ref-Factory — React ruft den Callback nicht erneut auf bei Re-Render
  const slideRef = useCallback(
    (i: number) => {
      if (!callbacksRef.current[i]) {
        callbacksRef.current[i] = (el: HTMLElement | null) => {
          slidesRef.current[i] = el;
          if (el) {
            const dim = getDim();
            const offset = i * dim - posRef.current;
            const tr = axis === "y" ? "Y" : "X";
            el.style.transform = `translate${tr}(${offset}px)`;
            // Ein frisch gemounteter Slide weit außerhalb des Bildschirms wird
            // gar nicht erst gemalt und bekommt auch keine eigene Ebene —
            // `applyPos` holt ihn zurück, sobald er in Reichweite kommt.
            const near = Math.abs(offset) <= dim * (RENDER_WINDOW + 0.5);
            el.style.visibility = near ? "" : "hidden";
            el.style.willChange = near ? "transform" : "";
          }
        };
      }
      return callbacksRef.current[i];
    },
    [axis, getDim],
  );

  return { currentIndex, settledIndex, slideRef, containerRef, snapTo, realign };
}
