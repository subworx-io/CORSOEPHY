import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

export interface BlockedProfile {
  id: string; // = blocked_id (die blockierte Person)
  handle: string;
}

// Liest die eigenen Blocks (RLS blocks_read_own) und kapselt block/unblock über die
// SECURITY-DEFINER-RPCs aus 0016. block_user löst serverseitig auch die gegenseitigen
// Follows auf — danach müssen die Feeds neu geladen werden, damit der RLS-Filter greift.
export function useBlocks() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["blocks", user?.id],
    queryFn: async (): Promise<BlockedProfile[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("blocks")
        .select("blocked_id, profiles!blocks_blocked_id_fkey(handle)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.blocked_id,
        handle: (row.profiles as unknown as { handle: string }).handle,
      }));
    },
    enabled: !!user,
  });

  // Feeds + Block-Liste invalidieren, damit ein frisch (ent)blockter Moment sofort
  // erscheint/verschwindet statt bis zum nächsten Refetch im Cache zu bleiben.
  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["discovery"] });
    void qc.invalidateQueries({ queryKey: ["city-story"] });
    void qc.invalidateQueries({ queryKey: ["connections-posts"] });
    void qc.invalidateQueries({ queryKey: ["blocks"] });
  };

  const block = async (targetId: string) => {
    const { error } = await supabase.rpc("block_user", { p_target: targetId });
    if (error) throw new Error(error.message);
    invalidateAll();
  };

  const unblock = async (targetId: string) => {
    const { error } = await supabase.rpc("unblock_user", { p_target: targetId });
    if (error) throw new Error(error.message);
    invalidateAll();
  };

  return { blocked: list.data ?? [], isLoading: list.isLoading, block, unblock };
}
