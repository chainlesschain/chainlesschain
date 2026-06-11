#!/bin/bash
# www-only atomic-swap redeploy (CLI version corrected to 0.162.40).
set -u
STAMP=$(date +%Y%m%d-%H%M%S)
dir=/www/wwwroot/www.chainlesschain.com
tar=/tmp/deploy-www.tar.gz
rm -rf "$dir.new"; mkdir -p "$dir.new"
tar -xzf "$tar" -C "$dir.new"
n=$(find "$dir.new" -name '*.html' | wc -l)
if [ ! -f "$dir.new/index.html" ] || [ "$n" -lt 15 ]; then
  echo "FAIL www: html=$n or index.html missing — live untouched"; rm -rf "$dir.new"; exit 1
fi
[ -d "$dir" ] && mv "$dir" "$dir.bak-$STAMP"
mv "$dir.new" "$dir"
chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
echo "OK www: html=$n live; ROLLBACK: mv $dir.bak-$STAMP $dir"
echo "=== CLI version chip in deployed index.html ==="
grep -oP "CLI v0\.162\.[0-9]+" "$dir/index.html" | sort -u
rm -f "$tar"
