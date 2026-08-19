import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { CityMomentCounts } from "@/lib/supabase/types";

// Holt die aggregierte Stadt-Zahl (Momente heute/gestern) über die argumentlose
// DB-Funktion city_moment_counts() — Kalendertag Europe/Berlin, nur Consent-Posts.
// staleTime 0 + Refetch-on-focus/mount wie der Discovery-Query, damit die Zahl beim
// Wiederöffnen frisch ist ("aktualisiert beim Öffnen/Refresh").
export function useCityMomentCounts() {
  return useQuery({
    queryKey: ["city-moment-counts"],
    queryFn: async (): Promise<CityMomentCounts | null> => {
      const { data, error } = await supabase.rpc("city_moment_counts");
      if (error) throw new Error(error.message);
      // returns table(...) → Array; erste (einzige) Zeile.
      const row = (data as CityMomentCounts[] | null)?.[0];
      return row ?? null;
    },
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}
