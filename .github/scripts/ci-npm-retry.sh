#!/usr/bin/env bash
# CI helper: wrap an npm install/ci command in a 3-attempt retry to ride out
# transient ECONNRESETs from the npm registry.
#
# Why: v5.0.3.44 release.yml's build-linux failed in 52s on a single
# ECONNRESET during `npm ci`. Same class of transient that motivated
# test-automation-full.yml's retry (issue #7). Without retry, a 1-in-50
# network blip aborts a 30-min release pipeline.
#
# Usage:
#   bash .github/scripts/ci-npm-retry.sh npm ci
#   bash .github/scripts/ci-npm-retry.sh npm install --legacy-peer-deps
#   bash .github/scripts/ci-npm-retry.sh npm install --no-save dmg-license
#
# Backoff: 15s / 30s; exits 1 on 3rd consecutive failure (downstream steps
# would otherwise run on a half-installed node_modules).

set -u

if [ "$#" -eq 0 ]; then
  echo "::error::ci-npm-retry.sh: no command provided"
  exit 2
fi

for i in 1 2 3; do
  if "$@"; then
    exit 0
  fi
  if [ "$i" -lt 3 ]; then
    delay=$((i * 15))
    echo "::warning::npm install attempt $i failed, retrying in ${delay}s..."
    sleep "$delay"
  fi
done

echo "::error::npm install failed after 3 attempts: $*"
exit 1
