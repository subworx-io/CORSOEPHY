import { createClient } from "@supabase/supabase-js";

// Browser-Client: nutzt den öffentlichen anon key. Jeder Zugriff ist durch
// Row Level Security (siehe 0001_init.sql) abgesichert. Für die PWA-Frontend-Seite.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Früh und deutlich scheitern statt mit kryptischem Netzwerkfehler später.
  throw new Error(
    "Supabase-Env fehlt: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env setzen (siehe .env.example).",
  );
}

const isBrowser = typeof window !== "undefined";

export const supabase = createClient(url, anonKey, {
  auth: {
    // SSR-safe: localStorage und window.location sind im CF-Worker nicht verfügbar.
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});
