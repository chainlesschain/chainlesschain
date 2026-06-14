#!/usr/bin/env bash
# Atomic swap re-deploy (docs + www) — picks up the [Unreleased] changelog
# notes (test-suite sweep + project-service export UTF-8 fix). Uploaded to
# /tmp and run via ssh. Per-site: extract to .new, verify html count +
# index.html, swap with a timestamped .bak rollback point, fix ownership.
# Fresh stamp (v109b) so it does not collide with the parallel v109 deploy's .bak.
set -u
STAMP="20260614-v109b"
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

deploy_one docs.chainlesschain.com /tmp/deploy-docs-v109b.tar.gz 500
deploy_one www.chainlesschain.com  /tmp/deploy-www-v109b.tar.gz  18
echo "=== DONE ==="
