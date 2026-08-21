import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { corsoDay } from "@/lib/corso-day";

// „Neu seit deinem letzten Besuch"-Punkte an den Tabs Discovery und Stadt Corso.
//
// Prinzip: pro Tab wird nur der JÜNGSTE Zeitstempel geholt (eine Zeile, billig,
// alle 60 s + bei Fokus) und mit einem lokalen „zuletzt gesehen"-Merker verglichen.
// Solange der Tab offen ist, wird der Merker laufend auf den jüngsten Stand gezogen —
// der Punkt erscheint also erst wieder, wenn NACH dem Verlassen etwas Neues kommt.
//
// Der Merker ist der Server-Zeitstempel selbst (kein Date.now()): so spielt die
// Geräteuhr keine Rolle, der Vergleich ist ein reiner String-Vergleich zweier ISO-
// Zeitstempel derselben Quelle.
//
// Merker in localStorage = pro Gerät (wie der Prompt-Splash). Kein Server-State,
// keine Migration; keine Zahl, nur „da ist was Neues" — nichts davon berührt die
// 🔒 Follower-Privatsphäre.

const CITY = (import.meta.env.VITE_PILOT_CITY as string | undefined) ?? "Düsseldorf";
const POLL_MS = 60_000;

const SEEN_KEYS = {
  discovery: "corso_seen_discovery_at",
  story: "corso_seen_story_at",
} as const;
type BadgeKey = keyof typeof SEEN_KEYS;

function readSeen(key: BadgeKey): string | null {
  try {
    return localStorage.getItem(SEEN_KEYS[key]);
  } catch {
    return null; // privater Modus o.ä. → kein Merker, Punkt bleibt ggf. sichtbar
  }
}

function writeSeen(key: BadgeKey, value: string) {
  try {
    localStorage.setItem(SEEN_KEYS[key], value);
  } catch {
    /* ignorieren */
  }
}

/** Jüngster lebender Moment eines anderen Nutzers (RLS blendet Abgelaufene/Geblockte aus). */
async function fetchLatestPostAt(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("created_at")
    .neq("author_id", userId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.created_at ?? null;
}

/** Jüngste Ziehung des laufenden Corso-Tags — derselbe Ausschnitt, den city_story() zeigt. */
async function fetchLatestStoryDrawAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from("city_story_slots")
    .select("created_at")
    .eq("city", CITY)
    .eq("story_date", corsoDay())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.created_at ?? null;
}

function useUnseen(key: BadgeKey, latest: string | null | undefined, isOpen: boolean): boolean {
  // Merker erst clientseitig lesen — im Cloudflare-Worker gibt es kein localStorage.
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    setSeen(readSeen(key));
  }, [key]);

  // Tab offen → alles, was gerade da ist, gilt als gesehen.
  useEffect(() => {
    if (!isOpen || !latest) return;
    if (seen && seen >= latest) return;
    writeSeen(key, latest);
    setSeen(latest);
  }, [isOpen, latest, seen, key]);

  if (isOpen || !latest) return false;
  return seen === null || latest > seen;
}

/**
 * Liefert pro Tab, ob es dort etwas gibt, das der Nutzer noch nicht gesehen hat.
 * `pathname` = aktuelle Route; der offene Tab zeigt nie einen Punkt und markiert
 * seinen Inhalt fortlaufend als gesehen.
 */
export function useUnseenBadges(pathname: string): { discovery: boolean; story: boolean } {
  const { user } = useAuth();
  const onDiscovery = pathname === "/";
  const onStory = pathname === "/story";

  const latestPost = useQuery({
    queryKey: ["unseen", "discovery", user?.id],
    queryFn: () => fetchLatestPostAt(user!.id),
    enabled: !!user,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const latestDraw = useQuery({
    queryKey: ["unseen", "story", user?.id],
    queryFn: fetchLatestStoryDrawAt,
    enabled: !!user,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Beim Betreten eines Tabs sofort frisch holen, damit der Merker den echten
  // Stand bekommt (nicht den bis zu 60 s alten Poll-Wert).
  const refetchPost = latestPost.refetch;
  const refetchDraw = latestDraw.refetch;
  useEffect(() => {
    if (onDiscovery) void refetchPost();
  }, [onDiscovery, refetchPost]);
  useEffect(() => {
    if (onStory) void refetchDraw();
  }, [onStory, refetchDraw]);

  return {
    discovery: useUnseen("discovery", latestPost.data, onDiscovery),
    story: useUnseen("story", latestDraw.data, onStory),
  };
}
