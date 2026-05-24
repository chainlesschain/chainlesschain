#!/usr/bin/env bash
# Run vault-search.test.js (FTS5 native integration) in an isolated sandbox.
#
# Background: the root node_modules bs3mc binding is built for Electron 39
# (NODE_MODULE_VERSION 140) which doesn't match ANY Node.js version
# (Node 24 = ABI 137, Node 25 = ABI 141). Plain `npm test` fails locally with
# ABI mismatch. CI is unaffected because its node_modules is built fresh.
#
# This script:
#   1. Copies lib/ + the target test into a temp sandbox
#   2. Installs a separate bs3mc compiled for the CURRENT host Node ABI
#   3. Runs vitest against it
#
# Idempotent; rerun any time. Sandbox lives under $TMPDIR/pdh-fts5-sandbox
# so it survives between runs (faster re-install).
#
# Usage: bash packages/personal-data-hub/scripts/run-native-tests-sandbox.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${TMPDIR:-/tmp}/pdh-fts5-sandbox"

echo "==> Sandbox: $SANDBOX"
mkdir -p "$SANDBOX/lib" "$SANDBOX/__tests__"

# Sync sources every run (lib/ may have evolved since last sandbox build)
cp -r "$ROOT/lib/." "$SANDBOX/lib/"
cp "$ROOT/__tests__/vault-search.test.js" "$SANDBOX/__tests__/"

# Minimal package.json — only the deps the target test needs.
cat > "$SANDBOX/package.json" <<'EOF'
{
  "name": "pdh-fts5-sandbox",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": { "test": "vitest run" },
  "dependencies": { "better-sqlite3-multiple-ciphers": "^12.5.0" },
  "devDependencies": { "vitest": "^4.1.5" }
}
EOF

if [ ! -d "$SANDBOX/node_modules/better-sqlite3-multiple-ciphers/build" ]; then
  echo "==> Installing deps (one-time, ~30-60s)"
  (cd "$SANDBOX" && npm install --no-audit --no-fund --loglevel=warn)
else
  echo "==> Deps already installed (skipping npm install)"
fi

echo "==> Running tests"
cd "$SANDBOX"
exec node ./node_modules/vitest/vitest.mjs run
