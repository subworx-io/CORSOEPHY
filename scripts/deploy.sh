#!/usr/bin/env bash
# Deploy Corso to Cloudflare Pages.
# Run from repo root: bash scripts/deploy.sh
set -euo pipefail

echo "▸ Build..."
bun run build

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
cat > deploy/_routes.json << 'EOF'
{"version":1,"include":["/*"],"exclude":["/assets/*","/favicon.ico","/manifest.json"]}
EOF

# Patch 1: react.mjs — jsxDEV = void 0 in React 19 production; shim to jsx
cat > deploy/_libs/react.mjs << 'REACTEOF'
import { t as __commonJSMin } from "../_runtime.mjs";
import { i as require_jsx_runtime } from "./react+tanstack__react-query.mjs";
var require_react_jsx_dev_runtime_production = /* @__PURE__ */ __commonJSMin(((exports) => {
	exports.Fragment = Symbol.for("react.fragment");
	var rt = require_jsx_runtime();
	exports.jsxDEV = function(type, props, key) { return rt.jsx(type, props, key); };
}));
var require_jsx_dev_runtime = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = require_react_jsx_dev_runtime_production();
}));
export { require_jsx_dev_runtime as t };
REACTEOF

# Patch 2: client bundle — React 19 production sets jsxDEV=void 0, but app uses jsxDEV.
# Shim jsxDEV to call the production I.jsx (already used 75x in the same bundle).
CLIENT_JS=$(ls deploy/assets/index-*.js 2>/dev/null | head -1)
if [ -n "$CLIENT_JS" ]; then
  node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const c = fs.readFileSync(f, 'utf8');
  const patched = c.replace('e.jsxDEV=void 0', 'e.jsxDEV=function(t,n,r){return I.jsx(t,n,r)}');
  if (c === patched) { console.error('Patch 2 target not found in ' + f); process.exit(1); }
  fs.writeFileSync(f, patched);
  console.log('Patch 2 applied to', f);
  " "$CLIENT_JS"
fi

# Patch 4: wrangler.json compat-date must not be in the future
WRANGLER_JSON=dist/server/wrangler.json
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$WRANGLER_JSON','utf8'));
cfg.compatibility_date = '2025-01-01';
fs.writeFileSync('$WRANGLER_JSON', JSON.stringify(cfg, null, 2));
"

echo "▸ Deploy to Cloudflare Pages..."
npx wrangler pages deploy deploy --project-name corso-app --commit-dirty=true

echo "✅ Done — https://corso-app.pages.dev"
