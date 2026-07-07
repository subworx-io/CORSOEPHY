import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

export interface FollowedPerson {
  handle: string;
  // Profil-ID des Followees (für DB-Ops). Bei optimistischem Follow evtl. kurz undefined,
  // bis der nächste DB-Reload sie nachträgt.
  id?: string;
  // Portrait nur für die Demo-Story-Handles; echte User haben keins → Video wird separat geladen.
  src: string | null;
  // Zeitpunkt des letzten (Re-)Follows in ms — Basis für das verfallende Herz
  followedAt: number;
  // Hat der User die Person heute (seit dem letzten 08:00-Reset) schon angestupst?
  nudged: boolean;
}

interface FollowContextType {
  followed: Map<string, FollowedPerson>;
  isFollowing: (handle: string) => boolean;
  follow: (person: { handle: string; src?: string | null }) => void;
  renew: (handle: string) => void;
  nudge: (handle: string) => void;
  // Dev/Test: den lokalen Stand aus der DB neu laden (verwirft optimistische Änderungen).
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

// Followee-Profil per Handle nachschlagen (für optimistisch gefolgte Personen ohne id).
async function profileIdByHandle(handle: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("id").eq("handle", handle).maybeSingle();
  return data?.id ?? null;
}

export function FollowProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Quelle der Wahrheit ist die DB. Start leer (SSR-sicher, keine Hydration-Mismatch),
  // echte Follows werden nach dem Mount / Login geladen.
  const [followed, setFollowed] = useState<Map<string, FollowedPerson>>(() => new Map());

  // Aktive Follows (+ Handles, +heutige Anstupser) aus der DB laden.
  const load = useCallback(async () => {
    if (!user) {
      setFollowed(new Map());
      return;
    }
    // Aktive Follows: expires_at is null (der Cron/Reset markiert Abgelaufene).
    const { data: rows } = await supabase
      .from("follows")
      .select("followed_at, followee_id")
      .eq("follower_id", user.id)
      .is("expires_at", null);
    if (!rows?.length) {
      setFollowed(new Map());
      return;
    }

    const followeeIds = rows.map((r) => r.followee_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, handle")
      .in("id", followeeIds);

    // Anstupser seit dem letzten 08:00-Reset → markiert „heute angestupst".
    const sinceReset = new Date(lastReset(Date.now())).toISOString();
    const { data: myNudges } = await supabase
      .from("nudges")
      .select("nudged_id")
      .eq("nudger_id", user.id)
      .gte("created_at", sinceReset);
    const nudgedSet = new Set((myNudges ?? []).map((n) => n.nudged_id));

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    const next = new Map<string, FollowedPerson>();
    for (const r of rows) {
      const prof = byId.get(r.followee_id);
      if (!prof) continue;
      next.set(prof.handle, {
        handle: prof.handle,
        id: prof.id,
        src: null,
        followedAt: new Date(r.followed_at).getTime(),
        nudged: nudgedSet.has(prof.id),
      });
    }
    setFollowed(next);
  }, [user]);

  // Bei Login / User-Wechsel neu laden.
  useEffect(() => {
    void load();
  }, [load]);

  // Am 2. Reset abgelaufene Follows sofort ausblenden (visuelle Sofortwirkung, bevor
  // der tägliche Cron expires_at setzt). DB bleibt Quelle der Wahrheit.
  useEffect(() => {
    const prune = () =>
      setFollowed((prev) => {
        const now = Date.now();
        let changed = false;
        const nextMap = new Map(prev);
        for (const [handle, p] of prev) {
          if (isExpired(p.followedAt, now)) {
            nextMap.delete(handle);
            changed = true;
          }
        }
        return changed ? nextMap : prev;
      });
    prune();
    const id = setInterval(prune, 60_000);
    return () => clearInterval(id);
  }, []);

  const isFollowing = (handle: string) => followed.has(handle);

  // Folgen: optimistisch lokal einfügen, dann in die DB schreiben und reconcilen.
  const follow = useCallback(
    (person: { handle: string; src?: string | null }) => {
      setFollowed((prev) => {
        if (prev.has(person.handle)) return prev;
        return new Map(prev).set(person.handle, {
          handle: person.handle,
          src: person.src ?? null,
          followedAt: Date.now(),
          nudged: false,
        });
      });
      void (async () => {
        if (!user) return;
        const followeeId = await profileIdByHandle(person.handle);
        if (!followeeId) return; // Demo-/Story-Handle ohne echtes Profil → bleibt optimistisch
        await supabase.from("follows").upsert(
          {
            follower_id: user.id,
            followee_id: followeeId,
            followed_at: new Date().toISOString(),
            expires_at: null,
          },
          { onConflict: "follower_id,followee_id" },
        );
        await load();
      })();
    },
    [user, load],
  );

  // Follow erneuern → Herz füllt wieder auf (followedAt zurücksetzen) + DB-Sync.
  const renew = useCallback(
    (handle: string) => {
      setFollowed((prev) => {
        const person = prev.get(handle);
        if (!person) return prev;
        return new Map(prev).set(handle, { ...person, followedAt: Date.now() });
      });
      void (async () => {
        if (!user) return;
        const followeeId = await profileIdByHandle(handle);
        if (!followeeId) return;
        await supabase.from("follows").upsert(
          {
            follower_id: user.id,
            followee_id: followeeId,
            followed_at: new Date().toISOString(),
            expires_at: null,
          },
          { onConflict: "follower_id,followee_id" },
        );
        await load();
      })();
    },
    [user, load],
  );

  // Anstupsen: optimistisch markieren + DB-Row (idempotent pro Tag über unique-Constraint).
  const nudge = useCallback(
    (handle: string) => {
      setFollowed((prev) => {
        const person = prev.get(handle);
        if (!person || person.nudged) return prev;
        return new Map(prev).set(handle, { ...person, nudged: true });
      });
      void (async () => {
        if (!user) return;
        const followeeId = await profileIdByHandle(handle);
        if (!followeeId) return;
        await supabase
          .from("nudges")
          .upsert(
            { nudger_id: user.id, nudged_id: followeeId },
            { onConflict: "nudger_id,nudged_id,nudge_date" },
          );
      })();
    },
    [user],
  );

  // Dev/Test: aus der DB neu laden (z.B. nach dem simulierten 08:00-Reset).
  const reset = useCallback(() => {
    void load();
  }, [load]);

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
