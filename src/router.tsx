import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Chunks schon bei Antipp-Absicht laden — zusammen mit preload="render" an
    // der BottomNav fühlt sich jeder Menüwechsel gleich schnell an (vorher
    // bufferte v.a. der Kamera-Screen beim Chunk-Fetch).
    defaultPreload: "intent",
  });

  return router;
};
