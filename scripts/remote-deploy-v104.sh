#!/bin/bash
# Atomic-swap deploy of 3 static sites — v5.0.3.104 (2026-06-10)
# Expects /tmp/deploy-docs.tar.gz /tmp/deploy-design.tar.gz /tmp/deploy-www.tar.gz
set -u
STAMP=$(date +%Y%m%d-%H%M%S)

deploy_site() {
  local name="$1" tar="$2" dir="$3" min_html="$4"
  echo "=== $name ==="
  if [ ! -f "$tar" ]; then echo "FAIL: $tar missing"; return 1; fi
  rm -rf "$dir.new"
  mkdir -p "$dir.new"
  tar -xzf "$tar" -C "$dir.new" || { echo "FAIL: untar $name"; rm -rf "$dir.new"; return 1; }
  local n
  n=$(find "$dir.new" -name '*.html' | wc -l)
  if [ "$n" -lt "$min_html" ] || [ ! -f "$dir.new/index.html" ]; then
    echo "FAIL: $name html=$n (min $min_html) or no index.html"; rm -rf "$dir.new"; return 1
  fi
  if [ -d "$dir" ]; then mv "$dir" "$dir.bak-$STAMP"; fi
  mv "$dir.new" "$dir"
  chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
  rm -f "$tar"
  echo "OK: $name html=$n ROLLBACK: mv $dir.bak-$STAMP $dir"
}

deploy_site "docs.chainlesschain.com"   /tmp/deploy-docs.tar.gz   /www/wwwroot/docs.chainlesschain.com   400
deploy_site "design.chainlesschain.com" /tmp/deploy-design.tar.gz /www/wwwroot/design.chainlesschain.com 200
deploy_site "www.chainlesschain.com"    /tmp/deploy-www.tar.gz    /www/wwwroot/www.chainlesschain.com    15

echo "=== smoke ==="
for u in https://docs.chainlesschain.com https://design.chainlesschain.com https://www.chainlesschain.com; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u")
  echo "$u -> $code"
done
df -h / | tail -1
