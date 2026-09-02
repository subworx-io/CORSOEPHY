import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { Connection } from "@/lib/supabase/types";

// Der Circle (Achse 2): beständige, gegenseitige Verbindungen aus `connections`.
// Entsteht serverseitig (Trigger in 0024), wenn sich zwei Menschen an genug
// Corso-Tagen gegenseitig gefolgt sind — die Schwelle ist bewusst NIRGENDS im
// Client bekannt oder abfragbar (🔒 Überraschungs-Moment).
//
// Sichtbarkeitsregel: die VERBINDUNG ist beständig (verfällt nie), die MOMENTE
// der Partner folgen weiter der 24h-Regel. Wer wen sieht, entscheiden die
// Screens — dieser Hook liefert nur die Verbindungen selbst.

export interface CirclePartner {
  connectionId: string;
  partnerId: string;
  handle: string;
  displayName: string | null;
  connectedAt: string;
  /** Die Circle-Ankündigung wurde von MIR noch nicht gesehen (serverseitig pro Person). */
  unseen: boolean;
}

const QUERY_KEY_BASE = "circle";

export function useCircle() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: partners = [], isLoading } = useQuery<CirclePartner[]>({
    queryKey: [QUERY_KEY_BASE, user?.id],
    queryFn: async () => {
      if (!user) return [];
      // RLS (connections_read_own) liefert nur die eigenen Verbindungen.
      const { data: rows } = await supabase
        .from("connections")
        .select("id, user_a_id, user_b_id, connected_at, announced_a_at, announced_b_at")
        .order("connected_at", { ascending: false });
      if (!rows?.length) return [];

      // Blockierte Partner ausblenden (eigene Blocks sind per RLS lesbar).
      // Die Gegenrichtung (jemand blockiert MICH) filtert dessen Client analog;
      // Momente/Chat sind serverseitig ohnehin in beide Richtungen gesperrt.
      const { data: blocks } = await supabase.from("blocks").select("blocked_id");
      const blocked = new Set((blocks ?? []).map((b) => b.blocked_id));

      const typed = rows as Connection[];
      const partnerIds = typed
        .map((c) => (c.user_a_id === user.id ? c.user_b_id : c.user_a_id))
        .filter((id) => !blocked.has(id));
      if (!partnerIds.length) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, handle, display_name")
        .in("id", partnerIds);
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

      return typed.flatMap((c): CirclePartner[] => {
        const partnerId = c.user_a_id === user.id ? c.user_b_id : c.user_a_id;
        const prof = byId.get(partnerId);
        if (!prof || blocked.has(partnerId)) return [];
        const announcedAt = c.user_a_id === user.id ? c.announced_a_at : c.announced_b_at;
        return [
          {
            connectionId: c.id,
            partnerId,
            handle: prof.handle,
            displayName: prof.display_name ?? null,
            connectedAt: c.connected_at,
            unseen: announcedAt == null,
          },
        ];
      });
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Ankündigung als gesehen markieren — serverseitig pro Person, damit die
  // Feier genau einmal erscheint (nicht einmal pro Gerät wie bei localStorage).
  const acknowledge = useCallback(
    async (connectionId: string) => {
      await supabase.rpc("acknowledge_circle", { p_connection: connectionId });
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEY_BASE, user?.id] });
    },
    [queryClient, user?.id],
  );

  return {
    partners,
    isLoading,
    /** Profil-IDs aller Circle-Partner — zum Ausfiltern aus Discovery/„Ich folge". */
    partnerIds: new Set(partners.map((p) => p.partnerId)),
    acknowledge,
  };
}
