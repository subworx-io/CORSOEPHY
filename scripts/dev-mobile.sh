#!/bin/bash
# Liest die aktuelle ngrok-URL, schreibt sie in .env und startet den Dev-Server.
# Voraussetzung: ngrok läuft bereits (ngrok http 3000).

set -e

NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | \
  python3 -c "import sys,json; t=json.load(sys.stdin).get('tunnels',[]); print(next((x['public_url'] for x in t if x['public_url'].startswith('https')), ''))" 2>/dev/null)

if [ -z "$NGROK_URL" ]; then
  echo "Kein ngrok-Tunnel aktiv. Starte zuerst: ngrok http 3000"
  exit 1
fi

echo "ngrok-URL: $NGROK_URL"

# VITE_APP_URL in .env aktualisieren
sed -i '' "s|VITE_APP_URL=.*|VITE_APP_URL=$NGROK_URL|" .env

echo ".env aktualisiert — starte Dev-Server..."

npm run dev
