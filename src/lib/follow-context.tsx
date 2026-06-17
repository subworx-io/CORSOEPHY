import { createContext, useContext, useState, type ReactNode } from "react";
import { PORTRAITS } from "@/assets/portraits";

export interface FollowedPerson {
  handle: string;
  src: string | null;
  followState: "today" | "renewed" | "renew" | "nudge";
}

interface FollowContextType {
  followed: Map<string, FollowedPerson>;
  isFollowing: (handle: string) => boolean;
  follow: (person: Omit<FollowedPerson, "followState">) => void;
}

const FollowContext = createContext<FollowContextType | null>(null);

const INITIAL_FOLLOWED: FollowedPerson[] = [
  { handle: "@sara_sound",   src: PORTRAITS.saraSound,    followState: "today" },
  { handle: "@elias_v",      src: PORTRAITS.eliasFashion, followState: "renewed" },
  { handle: "@david_arch",   src: PORTRAITS.davidArch,    followState: "renew" },
  { handle: "@marah.k",      src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCMsc8hfp9Lbs2mI6x5b6hEh9SfxUE1TjjuHKTvHmydbuoH7vuAAqenojfX6oG5lugKEGg6KWZupfy7An0ESbZ6VHN0G_hhUmnwsFlaLZt4V1JQDCIUFuUusg3kdsU5P1dFKWqMM585mTZB-G-qtWMnrW15E4qOro9c287DDc-U3vH7CiO30if3qzRXY9a6UOGP2W8K-WujTatDlp1ivyAk8LCQagacw5lNQCpnrblMNr46SHLkeyf-g_8A06MZRol7ODgXJhkrGeQ", followState: "today" },
  { handle: "@nina.pure",    src: PORTRAITS.ninaPure,     followState: "nudge" },
  { handle: "@jannis_lux",   src: PORTRAITS.jannisLux,    followState: "nudge" },
  { handle: "@leo.wild",     src: PORTRAITS.leoWild,      followState: "renew" },
  { handle: "@lukas.berlin", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuAPcJaaO61LZuueix4hrVPy7HIpLRzj6uvsrz4OCNOVv6BagJwwqSZobRp-Vax-IAmF0rC_nWE1rY4Pyg5B83__bFXsS7hzequ1Cu1Wo4LizHH8VLGVqbwGa2pvbBSa6MhDnmzo1KEwpAJzBfmgIO4DVcysq9gWUQi0cqGWPgCD4P6VyX4BRHlkbnPuLV2sGlN-3iTiD1mNDsLrDC1RPCOgLVNJf3An3KsDPzDCJpNgEy_9Rdq4Op2GNPa0jfjzo3fFz4itzZU348I", followState: "renewed" },
];

export function FollowProvider({ children }: { children: ReactNode }) {
  const [followed, setFollowed] = useState<Map<string, FollowedPerson>>(
    () => new Map(INITIAL_FOLLOWED.map((p) => [p.handle, p]))
  );

  const isFollowing = (handle: string) => followed.has(handle);

  const follow = (person: Omit<FollowedPerson, "followState">) => {
    setFollowed((prev) => {
      if (prev.has(person.handle)) return prev;
      return new Map(prev).set(person.handle, { ...person, followState: "today" });
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
