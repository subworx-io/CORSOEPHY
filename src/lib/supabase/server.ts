import { createClient } from "@supabase/supabase-js";

// Server-Client: nutzt den service_role key und UMGEHT RLS. Nur für serverseitige
// Logik (Server-Functions, geplante Jobs). Niemals im Browser verwenden.
//
// Der Key hat KEIN VITE_-Präfix → er landet nicht im Client-Bundle. Diese Datei
// darf nur aus Servercode importiert werden.
if (typeof window !== "undefined") {
  throw new Error("supabase/server.ts darf nicht im Browser geladen werden (service_role key!).");
}

const url = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "Server-Env fehlt: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env setzen (siehe .env.example).",
  );
}

export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
