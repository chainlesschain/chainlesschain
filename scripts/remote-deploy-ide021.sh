#!/usr/bin/env bash
# Atomic swap re-deploy (docs + design) — picks up the [Unreleased] changelog
# "Added — IDE Bridge 0.19/0.20/0.21" entry (docs site) and the module 98
# Phase 7 design-doc updates (both sites). www is unchanged this round, skipped.
# Uploaded to /tmp and run via ssh. Per-site: extract to .new, verify html
# count + index.html, swap with a timestamped .bak rollback point, fix owner.
set -u
STAMP="20260614-ide021"
WROOT=/www/wwwroot

deploy_one() {
  local site="$1" tar="$2" minhtml="$3"
  local dir="$WROOT/$site"
  echo "=== $site (min html $minhtml) ==="
  if [ ! -f "$tar" ]; then echo "MISSING TARBALL $tar"; return 1; fi
  rm -rf "$dir.new"
  mkdir -p "$dir.new"
  tar -xzf "$tar" -C "$dir.new"
  local n
  n=$(find "$dir.new" -name "*.html" | wc -l)
  if [ "$n" -lt "$minhtml" ]; then echo "ABORT $site: html $n < $minhtml"; rm -rf "$dir.new"; return 1; fi
  if [ ! -f "$dir.new/index.html" ]; then echo "ABORT $site: no index.html"; rm -rf "$dir.new"; return 1; fi
  rm -rf "$dir.bak-$STAMP"
  mv "$dir" "$dir.bak-$STAMP"
  mv "$dir.new" "$dir"
  chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
  echo "OK $site: $n html live. ROLLBACK: $dir.bak-$STAMP"
  rm -f "$tar"
}

deploy_one docs.chainlesschain.com   /tmp/deploy-docs-ide021.tar.gz   500
deploy_one design.chainlesschain.com /tmp/deploy-design-ide021.tar.gz 240
echo "=== DONE ==="
