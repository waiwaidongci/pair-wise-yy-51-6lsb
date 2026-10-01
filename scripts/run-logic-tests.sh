#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ENTRY="scripts/verify-entry.ts"
printf 'import "@angular/compiler"\nimport "./verify-logic"\n' > "$ENTRY"
trap 'rm -f "$ENTRY"' EXIT
npx esbuild "$ENTRY" --bundle --platform=node --format=esm --outfile=/tmp/verify.mjs --log-level=warning
node /tmp/verify.mjs
