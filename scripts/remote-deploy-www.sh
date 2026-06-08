#!/bin/bash
# www-only atomic-swap deploy. Tarball uploaded to /tmp/deploy-www.tar.gz
set -e
STAMP=$(date +%Y%m%d-%H%M%S)
name="www"; dir="/www/wwwroot/www.chainlesschain.com"; tar="/tmp/deploy-www.tar.gz"
echo "=== $name -> $dir ==="
if [ ! -f "$tar" ]; then echo "MISSING $tar"; exit 1; fi
rm -rf "$dir.new"
mkdir -p "$dir.new"
tar -xzf "$tar" -C "$dir.new"
n=$(find "$dir.new" -name '*.html' | wc -l)
echo "  html files: $n"
if [ "$n" -lt 1 ]; then echo "  ABORT: no html"; exit 1; fi
if [ -d "$dir" ]; then mv "$dir" "$dir.bak-$STAMP"; fi
mv "$dir.new" "$dir"
chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
echo "  OK: $(find "$dir" -name '*.html' | wc -l) html live; backup -> $dir.bak-$STAMP"
ls "$dir" | head -5
find /tmp -maxdepth 1 -name 'deploy-www.tar.gz' -delete
echo "WWW DONE stamp=$STAMP"
