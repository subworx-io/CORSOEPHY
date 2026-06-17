import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PORTRAITS } from "@/assets/portraits";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "ich folge — Korso" },
      { name: "description", content: "Menschen denen du folgst." },
    ],
  }),
  component: ConnectionsPage,
});

type FollowState = "today" | "renewed" | "renew" | "nudge";

interface Person {
  id: string;
  handle: string;
  src: string | null;
  followState: FollowState;
}

const PEOPLE: Person[] = [
  { id: "p1", handle: "@sara_sound", src: PORTRAITS.saraSound, followState: "today" },
  { id: "p2", handle: "@elias_v", src: PORTRAITS.eliasFashion, followState: "renewed" },
  { id: "p3", handle: "@david_arch", src: PORTRAITS.davidArch, followState: "renew" },
  { id: "p4", handle: "@marah.k", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCMsc8hfp9Lbs2mI6x5b6hEh9SfxUE1TjjuHKTvHmydbuoH7vuAAqenojfX6oG5lugKEGg6KWZupfy7An0ESbZ6VHN0G_hhUmnwsFlaLZt4V1JQDCIUFuUusg3kdsU5P1dFKWqMM585mTZB-G-qtWMnrW15E4qOro9c287DDc-U3vH7CiO30if3qzRXY9a6UOGP2W8K-WujTatDlp1ivyAk8LCQagacw5lNQCpnrblMNr46SHLkeyf-g_8A06MZRol7ODgXJhkrGeQ", followState: "today" },
  { id: "p5", handle: "@nina.pure", src: PORTRAITS.ninaPure, followState: "nudge" },
  { id: "p6", handle: "@jannis_lux", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCuu59PSEWUsK2k3Hywp03qrPdpdlxzVlyF0NtaVDa5FIxouDSRPHQY8tXBNu9yQhmVuqKrHmRq7azYU2_JJXa45Jjt5VESxpmHdZ5pQBUJ_BsHVlAmfwCh9ZuzeLkLdMHwDDJ2WG3Q_YkWUcmaHbWlYrKSvx1t987qzh1sBz9Bgo5vO_CEYoQETOTK9RCeyt8p3AXINmeM86s7n1QrJTCUT5wQ6THSzpaHhfS0708kZ8ttZVAfxzevERxsbUmxqHZR2TJVzCiJ2WM", followState: "nudge" },
  { id: "p7", handle: "@leo.wild", src: PORTRAITS.leoWild, followState: "renew" },
  { id: "p8", handle: "@lukas.berlin", src: "https://lh3.googleusercontent.com/aida-public/AB6AXuAPcJaaO61LZuueix4hrVPy7HIpLRzj6uvsrz4OCNOVv6BagJwwqSZobRp-Vax-IAmF0rC_nWE1rY4Pyg5B83__bFXsS7hzequ1Cu1Wo4LizHH8VLGVqbwGa2pvbBSa6MhDnmzo1KEwpAJzBfmgIO4DVcysq9gWUQi0cqGWPgCD4P6VyX4BRHlkbnPuLV2sGlN-3iTiD1mNDsLrDC1RPCOgLVNJf3An3KsDPzDCJpNgEy_9Rdq4Op2GNPa0jfjzo3fFz4itzZU348I", followState: "renewed" },
];

function HeartIcon({ filled, className = "" }: { filled: boolean; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined leading-none ${className}`}
      style={{ fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0" }}
    >
      favorite
    </span>
  );
}

function PersonCard({ person }: { person: Person }) {
  const [state, setState] = useState<FollowState>(person.followState);
  const [nudged, setNudged] = useState(false);
  const hasPosted = state !== "nudge";

  return (
    <div className="relative w-full rounded-2xl overflow-hidden aspect-[3/4] bg-neutral-900">
      {/* Bild oder leerer State */}
      {person.src && hasPosted ? (
        <img
          src={person.src}
          alt={person.handle}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          {/* Avatar-Placeholder */}
          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-white/30 text-[28px]">person</span>
          </div>
          <p className="text-white/30 text-[11px] text-center leading-snug px-3">
            Noch kein<br />Moment heute
          </p>
        </div>
      )}

      {/* Gradient */}
      {hasPosted && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      )}

      {/* Handle */}
      <div className="absolute top-3 left-3 z-10">
        <span className="text-white/80 text-[12px] font-medium tracking-tight">{person.handle}</span>
      </div>

      {/* Buttons */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-col gap-2">
        {/* Leere-Karte: zwei Buttons nebeneinander */}
        {state === "nudge" && (
          <div className="flex gap-2">
            <button
              onClick={() => setNudged(true)}
              disabled={nudged}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-full text-[12px] font-semibold transition-all active:scale-95 ${
                nudged
                  ? "bg-white/10 text-white/40"
                  : "bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25"
              }`}
            >
              <span className="material-symbols-outlined text-[14px] leading-none">notification_add</span>
              {nudged ? "angestupst" : "anstupsen"}
            </button>
            <button
              onClick={() => setState("renewed")}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-full text-[12px] font-semibold bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25 transition-all active:scale-95"
            >
              <HeartIcon filled={false} className="text-[14px]" />
              erneuern
            </button>
          </div>
        )}

        {/* Gepostet: ein Follow-Button */}
        {state === "today" && (
          <button className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full text-[12px] font-semibold bg-white text-black transition-all active:scale-95">
            <HeartIcon filled className="text-[14px]" />
            heute gefolgt
          </button>
        )}

        {state === "renewed" && (
          <button className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full text-[12px] font-semibold bg-white text-black transition-all active:scale-95">
            <HeartIcon filled className="text-[14px]" />
            follow erneuert
          </button>
        )}

        {state === "renew" && (
          <button
            onClick={() => setState("renewed")}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full text-[12px] font-semibold bg-white/15 backdrop-blur-md text-white border border-white/20 hover:bg-white/25 transition-all active:scale-95"
          >
            <HeartIcon filled={false} className="text-[14px]" />
            follow erneuern
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectionsPage() {
  return (
    <div className="h-dvh w-full bg-neutral-950 overflow-y-auto">
      <div className="px-4 pt-14 pb-28">
        <h1 className="text-white/50 text-[11px] uppercase tracking-[0.4em] font-medium mb-4">
          ich folge
        </h1>
        <div className="grid grid-cols-2 gap-3">
          {PEOPLE.map((person) => (
            <PersonCard key={person.id} person={person} />
          ))}
        </div>
      </div>
    </div>
  );
}
