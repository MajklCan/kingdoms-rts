#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js first, then run this script again."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting Kingdoms dev server..."
echo "Open this URL in the browser: http://127.0.0.1:5173/"
echo

npm run dev -- --host 127.0.0.1
