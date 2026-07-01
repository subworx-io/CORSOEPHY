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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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

  useEffect(() => {
    let active = true;

    // Initiale Session (übernimmt auch den Magic-Link-Hash aus der URL).
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        setProfile(await fetchProfile(data.session.user.id));
      }
      setLoading(false);
    });

    // Auf Login/Logout reagieren.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      setProfile(next?.user ? await fetchProfile(next.user.id) : null);
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
        loading,
        signInWithMagicLink,
        createProfile,
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
