import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

export interface TodayPrompt {
  id: string;
  text: string;
  active_date: string | null;
}

// Holt den heutigen Prompt über die geschützte DB-Funktion get_today_prompt()
// (SECURITY DEFINER: weist beim ersten Aufruf des Tages atomar zu, sonst gibt sie
// den bereits gesetzten zurück). Läuft mit dem normalen anon-Key + User-JWT —
// KEIN service_role, KEIN Server-Secret nötig. RLS „write nur service_role" bleibt
// gewahrt, weil nur die Funktion (nicht der Client direkt) schreiben darf.
//
// Geteilter Query-Key: Tages-Splash UND Kamera-Overlay lesen denselben Cache →
// nur EIN Call pro App-Session. Prompt ist den ganzen Corso-Tag stabil → langes staleTime.
export function useTodayPrompt() {
  return useQuery({
    queryKey: ["today-prompt"],
    queryFn: async (): Promise<TodayPrompt | null> => {
      const { data, error } = await supabase.rpc("get_today_prompt");
      if (error) throw new Error(error.message);
      return (data as TodayPrompt | null) ?? null;
    },
    staleTime: 1000 * 60 * 60 * 6, // 6h — deckt eine typische Session sicher ab
    refetchOnWindowFocus: false,
  });
}
