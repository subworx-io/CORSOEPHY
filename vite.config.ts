// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "cloudflare-module",
    output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
    cloudflare: { nodeCompat: true },
  },
  vite: {
    server: {
      host: true,
      port: 3000,
      // ngrok-Tunnel: Vite blockiert sonst fremde Hosts mit 403
      allowedHosts: [".ngrok-free.app", ".ngrok.io", ".ngrok.app"],
    },
    // React 19 production build removes jsxDEV; force production JSX transform
    // so builds use jsx/jsxs from react/jsx-runtime instead of jsxDEV.
    esbuild: {
      jsx: "automatic",
      jsxDev: false,
    },
  },
});
