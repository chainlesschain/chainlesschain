#!/usr/bin/env bash
# Atomic swap re-deploy (docs + www) for VS Code extension 0.23.0→0.27.0 changelog.
# docs.chainlesschain.com: VitePress build with the new "Added — IDE Bridge
# 0.23.0→0.27.0" changelog block (terminal-context / version-sync / Upgrade CLI /
# tabs-fix / App Preview crash-restart). www.chainlesschain.com: Astro build with
# the ide page's feature grid grown 七→九 / Seven→Nine cards (终端上下文共享 +
# CLI 版本对齐). design site unchanged this round, skipped.
# Per-site: extract to .new, verify html count + index.html, swap with a
# timestamped .bak rollback point, fix owner.
set -u
STAMP="20260615-ide027"
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

deploy_one docs.chainlesschain.com /tmp/deploy-docs-ide027.tar.gz 500
deploy_one www.chainlesschain.com  /tmp/deploy-www-ide027.tar.gz  18
echo "=== DONE ==="
