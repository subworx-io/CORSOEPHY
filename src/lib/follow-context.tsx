import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { cycleStart } from "@/lib/corso-day";

export interface FollowedPerson {
  handle: string;
  // Profil-ID des Followees (für DB-Ops). Bei optimistischem Follow evtl. kurz undefined,
  // bis der nächste DB-Reload sie nachträgt.
  id?: string;
  // Portrait nur für die Demo-Story-Handles; echte User haben keins → Video wird separat geladen.
  src: string | null;
  // Zeitpunkt des letzten (Re-)Follows in ms — Basis für das verfallende Herz
  followedAt: number;
  // Hat der User die Person in diesem Zyklus (seit 21:00) schon angestupst?
  nudged: boolean;
}

interface FollowContextType {
  followed: Map<string, FollowedPerson>;
  isFollowing: (handle: string) => boolean;
  follow: (person: { handle: string; src?: string | null }) => void;
  // Follow sofort beenden → Person fällt aus „Ich folge" und taucht wieder in Discovery auf.
  unfollow: (handle: string) => void;
  renew: (handle: string) => void;
  nudge: (handle: string) => void;
  // Dev/Test: den lokalen Stand aus der DB neu laden (verwirft optimistische Änderungen).
  reset: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Erneuern erst nach der Hälfte der Laufzeit — sonst wäre der Verfall per Dauer-Tippen aushebelbar. */
const RENEW_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Füllgrad des Herzens (0..1) — rollende 24h ab dem letzten (Re-)Follow.
 * Kein 08:00-Raster mehr: jeder Follow hat seine eigene Uhr. Voll im Moment des
 * Folgens, gleichmäßig leer nach genau 24 Stunden.
 * Spiegelt follows.expires_at der DB (= followed_at + 24h, per Trigger erzwungen).
 */
export function followFill(followedAt: number, now: number) {
  return Math.max(0, Math.min(1, 1 - (now - followedAt) / DAY_MS));
}

/** Follow ist 24h nach dem letzten (Re-)Follow abgelaufen → fliegt aus „Ich folge". */
export function isExpired(followedAt: number, now: number) {
  return now >= followedAt + DAY_MS;
}

/**
 * Erneuern ist ab der zweiten Hälfte möglich (Follow ≥ 12h alt). Nachfolge-Regel
 * zur alten „kein Doppel-Follow am selben Tag"-Regel (PRD 4.3): Erneuern bleibt
 * eine Entscheidung, kein Reflex. Serverseitig im Trigger gespiegelt.
 */
export function canRenew(followedAt: number, now: number) {
  return now - followedAt >= RENEW_AFTER_MS;
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
    // Aktive Follows: expires_at liegt in der Zukunft (rollende 24h ab Follow).
    // Seit 0015 ist expires_at IMMER gesetzt — „is null" wäre jetzt immer leer.
    const { data: rows } = await supabase
      .from("follows")
      .select("followed_at, followee_id")
      .eq("follower_id", user.id)
      .gt("expires_at", new Date().toISOString());
    if (!rows?.length) {
      setFollowed(new Map());
      return;
    }

    const followeeIds = rows.map((r) => r.followee_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, handle")
      .in("id", followeeIds);

    // Anstupser seit dem Zyklus-Start (21:00) → markiert „heute angestupst".
    // Das Anstups-Limit hängt weiter am Zyklus, nicht am rollenden 24h-Verfall.
    const sinceReset = new Date(cycleStart()).toISOString();
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

  // Nach 24h abgelaufene Follows sofort ausblenden, ohne auf einen Reload zu warten.
  // Die DB bleibt Quelle der Wahrheit (jede Query filtert auf expires_at > now()).
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
          // expires_at wird NICHT mitgeschickt: der DB-Trigger setzt ihn zwingend auf
          // followed_at + 24h. 🔒 So kann kein Client seinen Verfall verlängern.
          {
            follower_id: user.id,
            followee_id: followeeId,
            followed_at: new Date().toISOString(),
          },
          { onConflict: "follower_id,followee_id" },
        );
        await load();
      })();
    },
    [user, load],
  );

  // Entfolgen: optimistisch aus „Ich folge" entfernen, dann in der DB als abgelaufen
  // markieren (expires_at = now(), Verfall vorziehen statt löschen 🔒).
  // Danach erscheint die Person wieder in Discovery (dort reaktiv über `followed`).
  const unfollow = useCallback(
    (handle: string) => {
      let removed: FollowedPerson | undefined;
      setFollowed((prev) => {
        if (!prev.has(handle)) return prev;
        removed = prev.get(handle);
        const next = new Map(prev);
        next.delete(handle);
        return next;
      });
      void (async () => {
        if (!user) return;
        const followeeId = removed?.id ?? (await profileIdByHandle(handle));
        if (!followeeId) return;
        await supabase
          .from("follows")
          .update({ expires_at: new Date().toISOString() })
          .eq("follower_id", user.id)
          .eq("followee_id", followeeId)
          .gt("expires_at", new Date().toISOString());
      })();
    },
    [user],
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
          // expires_at wird NICHT mitgeschickt: der DB-Trigger setzt ihn zwingend auf
          // followed_at + 24h. 🔒 So kann kein Client seinen Verfall verlängern.
          {
            follower_id: user.id,
            followee_id: followeeId,
            followed_at: new Date().toISOString(),
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

  // Dev/Test: aus der DB neu laden (z.B. nachdem Follows im Dev-Menü verfallen sind).
  const reset = useCallback(() => {
    void load();
  }, [load]);

  return (
    <FollowContext.Provider value={{ followed, isFollowing, follow, unfollow, renew, nudge, reset }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error("useFollow must be used within FollowProvider");
  return ctx;
}
