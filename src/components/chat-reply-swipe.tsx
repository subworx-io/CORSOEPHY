import { useCallback, useEffect, useRef } from "react";

// Zieh-zum-Antworten (WhatsApp-Muster, Entscheidung Dominik 9. Sep 2026).
//
// GESTEN-LAGE IM CHAT: Der Chat liegt als eigenes Overlay AUSSERHALB des
// Snap-Containers von circle.tsx. `use-snap-scroll` prüft `isInsideContainer`
// und ignoriert Gesten von hier — es gibt also kein Durchgreifen auf den Feed
// darunter. Im Chat selbst war bislang keine Geste belegt: der Verlauf scrollt
// nativ, sonst nichts. Die Reply-Geste ist damit kollisionsfrei.
//
// ZWEI FALLEN, die dieser Hook bewusst umgeht:
//
//  1. NATIVES SCROLLEN. Der Verlauf muss weiter senkrecht scrollen. Deshalb ein
//     Achsen-Lock wie in use-swipe-follow: die erste eindeutige Richtung
//     entscheidet. `preventDefault` wird ERST gerufen, wenn die Geste als
//     waagerecht feststeht — vorher gehört sie dem Browser.
//
//  2. DIE ZURÜCK-GESTE VON iOS. Ein Rechts-Zug, der am linken Bildschirmrand
//     beginnt, löst in Safari/PWA die Zurück-Navigation aus und würde den Chat
//     schließen. Züge aus den ersten EDGE_GUARD_PX werden deshalb ignoriert.

/** Ab dieser Strecke gilt der Zug als Antwort-Wunsch. */
const COMMIT_PX = 60;
/** Weiter als das folgt die Blase dem Finger nicht (Gummiband). */
const MAX_PX = 88;
/** Totzone am linken Rand — dort gehört die Geste dem Betriebssystem. */
const EDGE_GUARD_PX = 24;
/** Erst ab hier steht die Achse fest. */
const AXIS_SLOP = 10;
const SPRING_MS = 220;

export function useChatReplySwipe(onReply: (messageId: string) => void) {
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;

  const nodesRef = useRef(new Map<string, HTMLElement | null>());
  const callbacksRef = useRef(new Map<string, (el: HTMLElement | null) => void>());

  /** Stabile Ref-Factory je Nachricht (Muster: slideRef in use-snap-scroll). */
  const rowRef = useCallback((messageId: string) => {
    let cb = callbacksRef.current.get(messageId);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) nodesRef.current.set(messageId, el);
        else nodesRef.current.delete(messageId);
      };
      callbacksRef.current.set(messageId, cb);
    }
    return cb;
  }, []);

  useEffect(() => {
    let active: { id: string; el: HTMLElement } | null = null;
    let startX = 0;
    let startY = 0;
    let axis: "none" | "x" | "y" = "none";

    const findRow = (target: EventTarget | null): { id: string; el: HTMLElement } | null => {
      const start = target instanceof Element ? target : null;
      if (!start) return null;
      for (const [id, el] of nodesRef.current) {
        if (el && el.contains(start)) return { id, el };
      }
      return null;
    };

    const setOffset = (el: HTMLElement, dx: number) => {
      el.style.transform = dx ? `translateX(${dx}px)` : "";
      el.style.setProperty("--reply-progress", String(Math.min(1, dx / COMMIT_PX)));
    };

    const release = (el: HTMLElement) => {
      el.style.transition = `transform ${SPRING_MS}ms cubic-bezier(0.22,1,0.36,1)`;
      setOffset(el, 0);
      window.setTimeout(() => {
        el.style.transition = "";
      }, SPRING_MS + 40);
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // Falle 2: Züge vom linken Rand gehören der Zurück-Geste des Systems.
      if (t.clientX < EDGE_GUARD_PX) {
        active = null;
        return;
      }
      active = findRow(e.target);
      startX = t.clientX;
      startY = t.clientY;
      axis = "none";
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (axis === "none") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_SLOP) return;
        // Falle 1: Senkrecht gewinnt im Zweifel — der Verlauf muss scrollen.
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (axis === "y") {
          active = null;
          return;
        }
      }
      if (axis !== "x") return;

      // Nur nach rechts; nach links passiert nichts.
      const eased =
        dx <= 0 ? 0 : Math.min(MAX_PX, dx <= COMMIT_PX ? dx : COMMIT_PX + (dx - COMMIT_PX) * 0.35);
      // Ab hier gehört die Geste uns — sonst scrollt der Verlauf mit.
      e.preventDefault();
      setOffset(active.el, eased);
    };

    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      const dx = e.changedTouches[0].clientX - startX;
      const { id, el } = active;
      active = null;
      release(el);
      if (axis === "x" && dx >= COMMIT_PX) onReplyRef.current(id);
    };

    // `passive: false` bei touchmove ist Pflicht — sonst ignoriert der Browser
    // das preventDefault und der Verlauf scrollt trotz waagerechter Geste.
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return { rowRef };
}
