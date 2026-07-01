import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PORTRAITS } from "@/assets/portraits";
import { supabase } from "@/lib/supabase/client";

// Persistenz-Schlüssel: Follow-State überlebt Reload auf demselben Gerät.
// (Kein geteilter Server — das ist Phase 0 und braucht eine Architektur-Entscheidung mit dem Eigner.)
const STORAGE_KEY = "corso.followed.v1";

export interface FollowedPerson {
  handle: string;
  src: string | null;
  // Zeitpunkt des letzten (Re-)Follows in ms — Basis für das verfallende Herz
  followedAt: number;
  // Hat die Person heute schon einen Moment gepostet? (unabhängig vom Follow-Status)
  hasPostedToday: boolean;
  // Hat der User die Person heute angestupst?
  nudged: boolean;
}

interface FollowContextType {
  followed: Map<string, FollowedPerson>;
  isFollowing: (handle: string) => boolean;
  follow: (person: Pick<FollowedPerson, "handle" | "src">) => void;
  renew: (handle: string) => void;
  nudge: (handle: string) => void;
  // Dev/Test: App auf den Demo-Ausgangszustand zurücksetzen (löscht den persistierten Stand).
  reset: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jüngster 08:00-Reset vor `now`. */
export function lastReset(now: number) {
  const r = new Date(now);
  r.setHours(8, 0, 0, 0);
  if (now < r.getTime()) r.setDate(r.getDate() - 1);
  return r.getTime();
}

/** Nächster 08:00-Reset echt nach `t` — der 1. Reset nach dem Follow. */
function firstResetAfter(t: number) {
  const r = new Date(t);
  r.setHours(8, 0, 0, 0);
  if (r.getTime() <= t) r.setDate(r.getDate() + 1);
  return r.getTime();
}

/**
 * Füllgrad des Herzens (0..1) — „Glas"-Logik (PRD 4.3, Variante A):
 * Voll & sicher bis zum 1. 08:00-Reset nach dem Follow. Danach läuft das Glas
 * über den Entscheidungstag gleichmäßig leer und ist am 2. Reset (24h später) leer.
 * Der Pegel hängt also am 08:00-Raster, nicht an einem gleitenden 24h-Fenster.
 */
export function followFill(followedAt: number, now: number) {
  const decisionStart = firstResetAfter(followedAt);
  if (now <= decisionStart) return 1; // bis zum 1. Reset: voll & sicher
  return Math.max(0, 1 - (now - decisionStart) / DAY_MS);
}

/** Follow läuft am 2. Reset ab, falls nicht erneuert → fliegt aus „Ich folge". */
export function isExpired(followedAt: number, now: number) {
  return now >= firstResetAfter(followedAt) + DAY_MS;
}

/**
 * Refolgen erst ab dem nächsten 08:00-Reset (PRD 4.3: kein Doppel-Follow am selben Tag).
 * → erneuerbar, wenn der letzte Follow vor dem heutigen Reset lag.
 */
export function canRenew(followedAt: number, now: number) {
  return followedAt < lastReset(now);
}

const FollowContext = createContext<FollowContextType | null>(null);

// Demo-Seeds relativ zum letzten 08:00-Reset, damit die Glas-Stände unter der
// Raster-Logik deterministisch sind (sonst je nach Uhrzeit sofort abgelaufen).
const NOW = Date.now();
const H = 60 * 60 * 1000;
const LAST_RESET = lastReset(NOW);

const INITIAL_FOLLOWED: FollowedPerson[] = [
  // heute (nach dem Reset) gefolgt → volles Glas, „folgst du heute"
  { handle: "@lena.rhein",    src: PORTRAITS.saraSound,    followedAt: NOW,                hasPostedToday: true,  nudged: false },
  // gestern gefolgt → Entscheidungstag, Glas läuft seit 08:00 leer, erneuerbar
  { handle: "@felix.rhein",   src: PORTRAITS.felixRhein,   followedAt: LAST_RESET - 3 * H, hasPostedToday: true,  nudged: false },
  // gestern gefolgt, heute noch kein Moment → leerer State, Glas läuft trotzdem leer
  { handle: "@nina.medien",   src: PORTRAITS.ninaPure,     followedAt: LAST_RESET - 6 * H, hasPostedToday: false, nudged: false },
  // gerade eben (re)folgt → volles Glas
  { handle: "@leo.see",       src: PORTRAITS.leoWild,      followedAt: NOW,                hasPostedToday: true,  nudged: false },
];

export function FollowProvider({ children }: { children: ReactNode }) {
  // SSR-sicher: Start immer deterministisch aus INITIAL_FOLLOWED (gleicher Server- & Client-
  // Render → keine Hydration-Mismatch). Der echte Stand aus localStorage wird erst nach dem
  // Mount geladen (siehe useEffect unten).
  const [followed, setFollowed] = useState<Map<string, FollowedPerson>>(
    () => new Map(INITIAL_FOLLOWED.map((p) => [p.handle, p]))
  );
  const [hydrated, setHydrated] = useState(false);

  // Einmaliges Laden des persistierten Stands (nur Client).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as FollowedPerson[];
        if (Array.isArray(arr)) {
          setFollowed(new Map(arr.map((p) => [p.handle, p])));
        }
      }
    } catch {
      // localStorage nicht verfügbar / korrupt → Demo-Seed bleibt stehen
    }
    setHydrated(true);
  }, []);

  // Persistieren bei jeder Änderung — aber erst nachdem geladen wurde,
  // sonst überschreibt der Demo-Seed den echten Stand beim ersten Render.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(followed.values())));
    } catch {
      // Schreiben fehlgeschlagen (z.B. privater Modus) → still ignorieren
    }
  }, [followed, hydrated]);

  // Abgelaufene Follows am 2. Reset entfernen (PRD 4.3: „Person A verschwindet").
  // Läuft nach der Hydration einmal sofort und danach minütlich.
  useEffect(() => {
    const prune = () =>
      setFollowed((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [handle, p] of prev) {
          if (isExpired(p.followedAt, now)) {
            next.delete(handle);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    prune();
    const id = setInterval(prune, 60_000);
    return () => clearInterval(id);
  }, [hydrated]);

  const isFollowing = (handle: string) => followed.has(handle);

  const follow = (person: Pick<FollowedPerson, "handle" | "src">) => {
    setFollowed((prev) => {
      if (prev.has(person.handle)) return prev;
      // Neu gefolgte Person stammt aus Discovery/Stadt-Story → hat heute gepostet, Herz voll
      return new Map(prev).set(person.handle, {
        ...person,
        followedAt: Date.now(),
        hasPostedToday: true,
        nudged: false,
      });
    });
  };

  // Follow erneuern → Herz füllt wieder auf (followedAt zurücksetzen) + DB-Sync
  const renew = (handle: string) => {
    setFollowed((prev) => {
      const person = prev.get(handle);
      if (!person) return prev;
      return new Map(prev).set(handle, { ...person, followedAt: Date.now() });
    });
    // DB: expires_at zurücksetzen, followed_at aktualisieren (fire-and-forget)
    void (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("handle", handle)
        .maybeSingle();
      if (!profile) return;
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) return;
      await supabase.from("follows").upsert(
        { follower_id: uid, followee_id: profile.id, followed_at: new Date().toISOString(), expires_at: null },
        { onConflict: "follower_id,followee_id" },
      );
    })();
  };

  const nudge = (handle: string) => {
    setFollowed((prev) => {
      const person = prev.get(handle);
      if (!person || person.nudged) return prev;
      return new Map(prev).set(handle, { ...person, nudged: true });
    });
  };

  // Zurück auf den Demo-Ausgangszustand. localStorage-Persistenz wird durch den
  // setState anschließend automatisch mit dem Seed überschrieben.
  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage nicht verfügbar → egal, der State-Reset unten reicht
    }
    setFollowed(new Map(INITIAL_FOLLOWED.map((p) => [p.handle, p])));
  };

  return (
    <FollowContext.Provider value={{ followed, isFollowing, follow, renew, nudge, reset }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error("useFollow must be used within FollowProvider");
  return ctx;
}
