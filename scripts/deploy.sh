#!/usr/bin/env bash
# Deploy Corso to Cloudflare Pages.
# Run from repo root: bash scripts/deploy.sh
set -euo pipefail

# WICHTIG: Produktions-Build erzwingen.
# Die .env setzt NODE_ENV=development (für den Dev-Server). Ohne Override würde
# der JSX-Transform (oxc/plugin-react) die Dev-Runtime nutzen und überall
# jsxDEV(...) emittieren — während React als Produktion gebaut wird und jsxDEV
# auf `void 0` setzt. Ergebnis: "(void 0) is not a function", die App crasht beim
# Rendern einer Route. NODE_ENV=production behebt das an der Wurzel (kein Patch nötig).
export NODE_ENV=production

echo "▸ Build (NODE_ENV=production)..."
# Build-Runner robust wählen: bun → npm → lokales vite.
if command -v bun >/dev/null 2>&1; then
  bun run build
elif command -v npm >/dev/null 2>&1; then
  npm run build
elif [ -x ./node_modules/.bin/vite ]; then
  ./node_modules/.bin/vite build
else
  echo "✗ Kein Build-Runner gefunden (bun/npm/vite). Abbruch." >&2
  exit 1
fi

# Sicherheitsnetz: Wenn doch wieder jsxDEV im Client-Bundle landet, NICHT deployen.
# (Würde bedeuten, dass der Produktions-Build-Fix oben nicht mehr greift.)
if grep -rlq 'jsxDEV' dist/client/assets 2>/dev/null; then
  echo "✗ jsxDEV im Client-Bundle gefunden — Produktions-Build hat nicht gegriffen. Abbruch." >&2
  echo "  Prüfen: läuft der Build wirklich mit NODE_ENV=production? Ist der JSX-Transform prod?" >&2
  exit 1
fi

echo "▸ Prepare deploy/"
rm -rf deploy
mkdir -p deploy

# Client assets
cp -r dist/client/* deploy/

# Worker entry + server modules
cp dist/server/index.mjs deploy/_worker.js
cp -r dist/server/_libs   deploy/
cp -r dist/server/_ssr    deploy/
cp -r dist/server/_chunks deploy/
cp    dist/server/_runtime.mjs deploy/
cp    dist/server/_tanstack-start-manifest*.mjs deploy/ 2>/dev/null || true

# sideEffects shim (prevents tree-shaking of _runtime.mjs)
echo '{"name":"corso-deploy","version":"1.0.0","sideEffects":true}' > deploy/package.json

# Routes: all dynamic except static assets
# /sw.js MUSS statisch ausgeliefert werden, nicht durch den SSR-Worker: ein
# Service Worker, der als HTML zurückkommt, registriert sich nicht — und Push
# scheitert dann ohne erkennbare Fehlermeldung.
cat > deploy/_routes.json << 'EOF'
{"version":1,"include":["/*"],"exclude":["/assets/*","/favicon.ico","/manifest.json","/sw.js"]}
EOF

echo "▸ Deploy to Cloudflare Pages..."
# Überschreibbar, damit derselbe Ablauf lokal und im Release-Workflow gilt:
#   CF_PAGES_PROJECT  — Pages-Projekt (Default: corso-app)
#   CF_BRANCH         — Ziel-Branch bei Pages. Ohne Angabe erkennt wrangler den
#                       Git-Branch; in CI ist das unzuverlässig, deshalb setzt der
#                       Workflow ihn explizit (main = Produktion, sonst Preview).
#   WRANGLER_VERSION  — gepinnt, damit ein Release nicht von "latest" abhängt.
PROJECT="${CF_PAGES_PROJECT:-corso-app}"
WRANGLER="wrangler@${WRANGLER_VERSION:-4.124.0}"

if [ -n "${CF_BRANCH:-}" ]; then
  npx -y "$WRANGLER" pages deploy deploy --project-name "$PROJECT" --commit-dirty=true --branch "$CF_BRANCH"
else
  npx -y "$WRANGLER" pages deploy deploy --project-name "$PROJECT" --commit-dirty=true
fi

echo "✅ Done — https://corso-app.pages.dev"
