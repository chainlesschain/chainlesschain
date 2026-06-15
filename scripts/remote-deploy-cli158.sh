#!/usr/bin/env bash
# Atomic swap re-deploy (docs + www) for the CLI command-count correction
# 155 -> 158. docs.chainlesschain.com (VitePress) + www.chainlesschain.com
# (Astro) both carry the count claim. Per-site: extract to .new, verify html
# count + index.html, swap with a timestamped .bak rollback point, fix owner.
set -u
STAMP="20260615-cli158"
WROOT=/www/wwwroot

deploy_one() {
  local site="$1" tar="$2" minhtml="$3"
  local dir="$WROOT/$site"
  echo "=== $site (min html $minhtml) ==="
  if [ ! -f "$tar" ]; then echo "MISSING TARBALL $tar"; return 1; fi
  rm -rf "$dir.new"; mkdir -p "$dir.new"
  tar -xzf "$tar" -C "$dir.new"
  local n; n=$(find "$dir.new" -name "*.html" | wc -l)
  if [ "$n" -lt "$minhtml" ]; then echo "ABORT $site: html $n < $minhtml"; rm -rf "$dir.new"; return 1; fi
  if [ ! -f "$dir.new/index.html" ]; then echo "ABORT $site: no index.html"; rm -rf "$dir.new"; return 1; fi
  rm -rf "$dir.bak-$STAMP"
  mv "$dir" "$dir.bak-$STAMP"
  mv "$dir.new" "$dir"
  chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
  echo "OK $site: $n html live. ROLLBACK: $dir.bak-$STAMP"
  rm -f "$tar"
}

deploy_one docs.chainlesschain.com /tmp/deploy-docs-cli158.tar.gz 500
deploy_one www.chainlesschain.com  /tmp/deploy-www-cli158.tar.gz  18
echo "=== DONE ==="
