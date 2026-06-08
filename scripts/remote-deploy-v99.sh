#!/bin/bash
# Atomic-swap deploy for the 3 static sites (run on production host via plink).
# Mirrors scripts/deploy-all.py logic. Uploaded tarballs live at /tmp/deploy-<name>.tar.gz
set -e
STAMP=$(date +%Y%m%d-%H%M%S)

deploy_one() {
  local name="$1" dir="$2" tar="/tmp/deploy-$1.tar.gz"
  echo "=== $name -> $dir ==="
  if [ ! -f "$tar" ]; then echo "MISSING $tar"; exit 1; fi
  rm -rf "$dir.new"
  mkdir -p "$dir.new"
  tar -xzf "$tar" -C "$dir.new"
  local n
  n=$(find "$dir.new" -name '*.html' | wc -l)
  echo "  html files: $n"
  if [ "$n" -lt 1 ]; then echo "  ABORT: no html in $name"; exit 1; fi
  if [ -d "$dir" ]; then mv "$dir" "$dir.bak-$STAMP"; fi
  mv "$dir.new" "$dir"
  chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
  echo "  OK: $(find "$dir" -name '*.html' | wc -l) html live; backup -> $dir.bak-$STAMP"
  ls "$dir" | head -5
}

deploy_one "docs"   "/www/wwwroot/docs.chainlesschain.com"
deploy_one "design" "/www/wwwroot/design.chainlesschain.com"
deploy_one "www"    "/www/wwwroot/www.chainlesschain.com"

echo "=== cleanup ==="
find /tmp -maxdepth 1 -name 'deploy-*.tar.gz' -delete
echo "ALL DONE stamp=$STAMP"
