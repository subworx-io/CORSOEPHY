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
import { logAppOpen } from "./events";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  // true, solange die initiale Session-/Profil-Prüfung läuft (SSR + erster Client-Render)
  loading: boolean;
  // Login-Mail anfordern. Die Mail enthält BEIDES: einen 6-stelligen Code und
  // einen Link. Der Code ist der Hauptweg — siehe Kommentar bei verifyLoginCode.
  requestLoginCode: (email: string) => Promise<{ error: string | null }>;
  // Den 6-stelligen Code einlösen. Erzeugt die Session GENAU DORT, wo der Code
  // eingetippt wurde — das ist der ganze Punkt (siehe unten).
  verifyLoginCode: (email: string, code: string) => Promise<{ error: string | null }>;
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

/**
 * Wartet höchstens `ms` auf die Session-Prüfung und gibt danach die Oberfläche frei —
 * ABER bricht die Prüfung nicht ab. Trudelt die Antwort später ein, wird sie noch
 * angewandt und der Nutzer landet automatisch in der App.
 *
 * Vorher wurde bei Zeitüberschreitung geworfen und das Ergebnis verworfen: bei
 * langsamem Netz sah man den Login-Screen, obwohl eine gültige Session im Speicher lag.
 * Auf dem Handy (Funkloch, Tunnel, kalter Start) ist das kein Randfall.
 */
function raceTimeout<T>(promise: PromiseLike<T>, ms: number, onLate: (value: T) => void) {
  let settled = false;
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(
        `[auth] Session-Prüfung > ${ms}ms — Oberfläche wird freigegeben, Prüfung läuft weiter.`,
      );
      resolve(null);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (settled)
          onLate(value); // zu spät für den ersten Render, aber nicht verloren
        else {
          settled = true;
          resolve(value);
        }
      },
      (error) => {
        clearTimeout(timer);
        console.error("[auth] Session-Prüfung fehlgeschlagen:", error);
        if (!settled) {
          settled = true;
          resolve(null);
        }
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
      // Nachzügler: kommt die Session erst nach dem Timeout, wird sie trotzdem
      // übernommen — der Nutzer rutscht dann von selbst aus dem Login in die App.
      const applyLate = (result: Awaited<ReturnType<typeof supabase.auth.getSession>>) => {
        if (!active || !result?.data?.session) return;
        setSession(result.data.session);
        void syncProfile(result.data.session.user?.id ?? null);
      };
      const result = await raceTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS, applyLate);
      if (!active) return;
      if (result) {
        setSession(result.data.session);
        await syncProfile(result.data.session?.user?.id ?? null);
      }
      setLoading(false);
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

  /**
   * Fordert die Login-Mail an.
   *
   * 🔒 `shouldCreateUser: false` — ohne das legt Supabase für JEDE eingetippte
   *    Adresse ein Konto an, und das Einladungs-System wäre über das Login-Formular
   *    umgehbar. Die Tür ist der Einladungs-Link, nicht dieses Feld.
   */
  // app_open-Instrumentierung (Metrik-Tracking): feuert bei Kaltstart/Login
  // (sobald eine User-ID vorliegt) UND bei jeder Rückkehr in den Vordergrund
  // (visibilitychange → visible). Nur bei eingeloggtem User — log_event() würfe
  // sonst „not authenticated". Das Entprellen (max. 1 / 5 min) liegt in
  // logAppOpen(); der Mount- und der sofortige visible-Fall zählen so nicht doppelt.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    // Kaltstart / frischer Login: einmal feuern, wenn die Seite sichtbar ist.
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      logAppOpen();
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") logAppOpen();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [userId]);

  const requestLoginCode = useCallback(async (email: string) => {
    // VITE_APP_URL bevorzugen (ngrok/Prod-URL), damit der Link im Mail auch auf
    // einem echten Gerät auf den richtigen Host zeigt.
    const redirectTo =
      import.meta.env.VITE_APP_URL ??
      (typeof window !== "undefined" ? window.location.origin : undefined);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (!error) return { error: null };
    // Supabase antwortet hier technisch ("Signups not allowed for otp") — für den
    // Nutzer ist die einzig sinnvolle Aussage: du bist nicht eingeladen.
    const raw = error.message.toLowerCase();
    if (raw.includes("signups not allowed") || raw.includes("not found")) {
      return {
        error: "Diese E-Mail ist nicht eingeladen. Bitte Maxim um einen Einladungs-Link.",
      };
    }
    return { error: error.message };
  }, []);

  /**
   * Löst den 6-stelligen Code ein.
   *
   * Warum der Code der Hauptweg ist: Auf dem iPhone hat eine Home-Bildschirm-App
   * einen eigenen Speicher, getrennt von Safari. Ein angetippter Login-Link öffnet
   * IMMER in Safari — die Session landet dort und die Home-Bildschirm-App bleibt
   * dauerhaft ausgeloggt. Ein eingetippter Code erzeugt die Session dagegen genau
   * in der App, in der er eingetippt wurde. Der Link bleibt als Rückfall für
   * Desktop/Android, wo dieses Problem nicht existiert.
   */
  const verifyLoginCode = useCallback(async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.replace(/\D/g, ""), // Leerzeichen/Bindestriche aus dem Einfügen dulden
      type: "email",
    });
    if (!error) return { error: null };
    const raw = error.message.toLowerCase();
    if (raw.includes("expired")) {
      return { error: "Dieser Code ist abgelaufen. Fordere einen neuen an." };
    }
    if (raw.includes("invalid")) {
      return { error: "Code stimmt nicht. Nochmal prüfen — er steht in der Mail." };
    }
    return { error: error.message };
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
        requestLoginCode,
        verifyLoginCode,
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
