import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import type { Profile } from "./supabase/types";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  // true, solange die initiale Session-/Profil-Prüfung läuft (SSR + erster Client-Render)
  loading: boolean;
  // Magic-Link an die E-Mail schicken
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  // Profil (Handle) nach erstem Login anlegen — 1 Gesicht = 1 Handle
  createProfile: (handle: string) => Promise<{ error: string | null }>;
  // Eigene Profilfelder ändern (Anzeigename, Push-Präferenz). Aktualisiert auch
  // den lokalen State, damit der Screen konsistent bleibt und Reload übersteht.
  updateProfile: (
    fields: Partial<Pick<Profile, "display_name" | "push_enabled">>,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Notbremse für die initiale Session-Prüfung. Hängt sie (Netz weg, Token-Refresh
// blockiert, Auth-Lock von einem anderen Tab gehalten), soll der Splash nicht
// ewig stehen bleiben — nach dieser Zeit geht es ohne Session weiter (Login).
const SESSION_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("auth: session check timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Start im Loading-Zustand: Server und erster Client-Render zeigen denselben
  // neutralen Splash → keine Hydration-Mismatch. Die echte Session wird erst
  // nach dem Mount aus dem Storage / der URL geladen.
  const [loading, setLoading] = useState(true);
  // true, während für eine frische Session das Profil noch geholt wird. Verhindert,
  // dass der Handle-Screen kurz aufblitzt, bevor das Profil da ist.
  const [profilePending, setProfilePending] = useState(false);

  useEffect(() => {
    let active = true;
    // Für welchen User zuletzt ein Profil angefordert wurde — so überschreibt eine
    // langsame Antwort nicht den inzwischen gewechselten User.
    let pendingUserId: string | null = null;

    async function syncProfile(userId: string | null) {
      pendingUserId = userId;
      if (!userId) {
        setProfile(null);
        return;
      }
      setProfilePending(true);
      try {
        const next = await fetchProfile(userId);
        if (!active || pendingUserId !== userId) return;
        setProfile(next);
      } finally {
        if (active && pendingUserId === userId) setProfilePending(false);
      }
    }

    // Initiale Session (übernimmt auch den Magic-Link-Hash aus der URL).
    // Der Splash hängt an diesem einen Aufruf — er MUSS unter allen Umständen
    // enden, sonst kommt man nur per Reload in die App.
    void (async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS);
        if (!active) return;
        setSession(data.session);
        await syncProfile(data.session?.user?.id ?? null);
      } catch (err) {
        // Bewusst weich: lieber der Login-Screen als ein Splash ohne Ausweg.
        console.error("[auth] Initiale Session-Prüfung fehlgeschlagen:", err);
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Auf Login/Logout reagieren.
    // ⚠️ Dieser Callback MUSS synchron bleiben. supabase-js ruft ihn auf, während
    // der interne Auth-Lock gehalten wird; ein `await` auf einen weiteren
    // Supabase-Aufruf (hier: Profil laden) verklemmt sich mit genau diesem Lock.
    // Das ließ die App beim ersten Aufruf im Splash hängen. Profil deshalb erst
    // im nächsten Tick laden — außerhalb des Locks.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setTimeout(() => {
        if (active) void syncProfile(next?.user?.id ?? null);
      }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    // Prefer VITE_APP_URL (set to the current ngrok/prod URL in .env) so the
    // magic-link points to the right host even when opened on a physical device.
    // Falls back to window.location.origin for pure localhost dev.
    const redirectTo =
      import.meta.env.VITE_APP_URL ??
      (typeof window !== "undefined" ? window.location.origin : undefined);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    return { error: error?.message ?? null };
  }, []);

  const createProfile = useCallback(
    async (handle: string) => {
      if (!session?.user) return { error: "Nicht eingeloggt." };
      const normalized = handle.startsWith("@") ? handle : `@${handle}`;
      const { data, error } = await supabase
        .from("profiles")
        .insert({ id: session.user.id, handle: normalized })
        .select("*")
        .single();
      if (error) return { error: error.message };
      setProfile(data as Profile);
      return { error: null };
    },
    [session],
  );

  const updateProfile = useCallback(
    async (fields: Partial<Pick<Profile, "display_name" | "push_enabled">>) => {
      if (!session?.user) return { error: "Nicht eingeloggt." };
      const { data, error } = await supabase
        .from("profiles")
        .update(fields)
        .eq("id", session.user.id)
        .select("*")
        .single();
      if (error) return { error: error.message };
      setProfile(data as Profile);
      return { error: null };
    },
    [session],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        // Splash auch, solange für eine Session das Profil noch unterwegs ist —
        // sonst blitzt der Handle-Screen bei bestehendem Profil kurz auf.
        // Beim Hintergrund-Refresh (Profil schon da) bleibt es aus.
        loading: loading || (!!session && !profile && profilePending),
        signInWithMagicLink,
        createProfile,
        updateProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
