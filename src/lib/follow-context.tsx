import { createContext, useContext, useState, type ReactNode } from "react";
import { PORTRAITS } from "@/assets/portraits";

export interface FollowedPerson {
  handle: string;
  src: string | null;
  // Status des Follows selbst (heute frisch / erneuert / wartet auf Erneuerung)
  followState: "today" | "renewed" | "renew";
  // Unabhängig davon: hat die Person heute schon einen Moment gepostet?
  hasPostedToday: boolean;
}

interface FollowContextType {
  followed: Map<string, FollowedPerson>;
  isFollowing: (handle: string) => boolean;
  follow: (person: Pick<FollowedPerson, "handle" | "src">) => void;
}

const FollowContext = createContext<FollowContextType | null>(null);

const INITIAL_FOLLOWED: FollowedPerson[] = [
  { handle: "@sara_sound",   src: PORTRAITS.saraSound,    followState: "today",   hasPostedToday: true },
  { handle: "@elias_v",      src: PORTRAITS.eliasFashion, followState: "renewed", hasPostedToday: true },
  { handle: "@david_arch",   src: PORTRAITS.davidArch,    followState: "renew",   hasPostedToday: true },
  { handle: "@marah.k",      src: PORTRAITS.miaGalerie,   followState: "today",   hasPostedToday: true },
  { handle: "@nina.pure",    src: PORTRAITS.ninaPure,     followState: "renew",   hasPostedToday: false },
  { handle: "@jannis_lux",   src: PORTRAITS.jannisLux,    followState: "renew",   hasPostedToday: false },
  { handle: "@leo.wild",     src: PORTRAITS.leoWild,      followState: "renew",   hasPostedToday: true },
  { handle: "@lukas.berlin", src: PORTRAITS.paulAltstadt, followState: "renewed", hasPostedToday: true },
];

export function FollowProvider({ children }: { children: ReactNode }) {
  const [followed, setFollowed] = useState<Map<string, FollowedPerson>>(
    () => new Map(INITIAL_FOLLOWED.map((p) => [p.handle, p]))
  );

  const isFollowing = (handle: string) => followed.has(handle);

  const follow = (person: Pick<FollowedPerson, "handle" | "src">) => {
    setFollowed((prev) => {
      if (prev.has(person.handle)) return prev;
      // Neu gefolgte Person stammt aus Discovery/Stadt-Story → hat heute gepostet
      return new Map(prev).set(person.handle, {
        ...person,
        followState: "today",
        hasPostedToday: true,
      });
    });
  };

  return (
    <FollowContext.Provider value={{ followed, isFollowing, follow }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error("useFollow must be used within FollowProvider");
  return ctx;
}
