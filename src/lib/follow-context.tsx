import { createContext, useContext, useState, type ReactNode } from "react";
import { PORTRAITS } from "@/assets/portraits";

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
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Füllgrad des Herzens (0..1): voll bei frischem Follow, leer nach 24h. */
export function followFill(followedAt: number, now: number) {
  return Math.max(0, Math.min(1, 1 - (now - followedAt) / DAY_MS));
}

/** Jüngster 08:00-Reset vor `now`. */
export function lastReset(now: number) {
  const r = new Date(now);
  r.setHours(8, 0, 0, 0);
  if (now < r.getTime()) r.setDate(r.getDate() - 1);
  return r.getTime();
}

/**
 * Refolgen erst ab dem nächsten 08:00-Reset (PRD 4.3: kein Doppel-Follow am selben Tag).
 * → erneuerbar, wenn der letzte Follow vor dem heutigen Reset lag.
 */
export function canRenew(followedAt: number, now: number) {
  return followedAt < lastReset(now);
}

const FollowContext = createContext<FollowContextType | null>(null);

// Demo-Zeitpunkte relativ zum App-Start, damit die Herzen unterschiedliche Füllstände zeigen.
const NOW = Date.now();
const H = 60 * 60 * 1000;

const INITIAL_FOLLOWED: FollowedPerson[] = [
  // frisch heute gefolgt → volles Herz, (noch) nicht erneuerbar
  { handle: "@lena.rhein",    src: PORTRAITS.saraSound,    followedAt: NOW - 1 * H,  hasPostedToday: true,  nudged: false },
  // gestern → halb verfallen, erneuerbar
  { handle: "@felix.rhein",   src: PORTRAITS.felixRhein,   followedAt: NOW - 14 * H, hasPostedToday: true,  nudged: false },
  // hat heute noch nicht gepostet → leerer State, Herz fast leer
  { handle: "@nina.medien",   src: PORTRAITS.ninaPure,     followedAt: NOW - 20 * H, hasPostedToday: false, nudged: false },
  // läuft fast ab → Herz nahezu leer, dringend erneuern
  { handle: "@leo.see",       src: PORTRAITS.leoWild,      followedAt: NOW - 26 * H, hasPostedToday: true,  nudged: false },
];

export function FollowProvider({ children }: { children: ReactNode }) {
  const [followed, setFollowed] = useState<Map<string, FollowedPerson>>(
    () => new Map(INITIAL_FOLLOWED.map((p) => [p.handle, p]))
  );

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

  // Follow erneuern → Herz füllt wieder auf (followedAt zurücksetzen)
  const renew = (handle: string) => {
    setFollowed((prev) => {
      const person = prev.get(handle);
      if (!person) return prev;
      return new Map(prev).set(handle, { ...person, followedAt: Date.now() });
    });
  };

  const nudge = (handle: string) => {
    setFollowed((prev) => {
      const person = prev.get(handle);
      if (!person || person.nudged) return prev;
      return new Map(prev).set(handle, { ...person, nudged: true });
    });
  };

  return (
    <FollowContext.Provider value={{ followed, isFollowing, follow, renew, nudge }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error("useFollow must be used within FollowProvider");
  return ctx;
}
