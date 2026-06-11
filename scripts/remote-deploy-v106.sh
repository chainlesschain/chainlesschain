#!/bin/bash
# Atomic-swap deploy for v5.0.3.106 docs sites. Per-site: extract to .new,
# verify html count + index.html, swap old→.bak-<stamp>, mv .new→live, chown.
set -u
STAMP=$(date +%Y%m%d-%H%M%S)
ROOT=/www/wwwroot

deploy() {
  local domain="$1" tar="$2" min="$3"
  local dir="$ROOT/$domain"
  echo "=== $domain ==="
  rm -rf "$dir.new"
  mkdir -p "$dir.new"
  tar -xzf "$tar" -C "$dir.new"
  local n
  n=$(find "$dir.new" -name '*.html' | wc -l)
  if [ ! -f "$dir.new/index.html" ] || [ "$n" -lt "$min" ]; then
    echo "FAIL $domain: html=$n (min $min) or index.html missing — aborting, live untouched"
    rm -rf "$dir.new"
    return 1
  fi
  if [ -d "$dir" ]; then
    mv "$dir" "$dir.bak-$STAMP"
  fi
  mv "$dir.new" "$dir"
  chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
  echo "OK $domain: html=$n live; ROLLBACK: mv $dir.bak-$STAMP $dir"
  rm -f "$tar"
}

deploy docs.chainlesschain.com   /tmp/deploy-docs.tar.gz   500
deploy design.chainlesschain.com /tmp/deploy-design.tar.gz 200
deploy www.chainlesschain.com    /tmp/deploy-www.tar.gz    15
echo "=== done @ $STAMP ==="
