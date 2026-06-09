#!/usr/bin/env bash
# Atomic-swap deploy for the 3 static sites — v5.0.3.101.
# Uploaded to the server /tmp and run via `ssh root@host bash /tmp/remote-deploy-v101.sh`.
# Mirrors scripts/deploy-all.py / the PuTTY recipe: extract to <dir>.new, verify
# html count, then mv <dir> -> <dir>.bak-<stamp>, mv <dir>.new -> <dir>, chown.
set -u

STAMP=$(date +%Y%m%d-%H%M%S)
WWWROOT=/www/wwwroot

# tarball  remotedir  min_html
deploy_one() {
  local tar="$1" site="$2" minhtml="$3"
  local dir="$WWWROOT/$site"
  local newdir="$dir.new"
  echo "=== $site (min html=$minhtml) ==="
  if [ ! -f "/tmp/$tar" ]; then echo "  ABORT: /tmp/$tar missing"; return 1; fi
  rm -rf "$newdir"
  mkdir -p "$newdir"
  tar -xzf "/tmp/$tar" -C "$newdir"
  local n
  n=$(find "$newdir" -name '*.html' | wc -l)
  echo "  extracted html: $n"
  if [ "$n" -lt "$minhtml" ]; then
    echo "  ABORT: html count $n < $minhtml — leaving live site untouched"
    rm -rf "$newdir"
    return 1
  fi
  if [ -d "$dir" ]; then
    mv "$dir" "$dir.bak-$STAMP"
  fi
  mv "$newdir" "$dir"
  chown -R www:www "$dir" 2>/dev/null || chown -R nginx:nginx "$dir" 2>/dev/null || true
  echo "  OK: live -> $dir  (rollback: mv $dir.bak-$STAMP $dir)"
}

rc=0
deploy_one "deploy-docs.tar.gz"   "docs.chainlesschain.com"   400 || rc=1
deploy_one "deploy-design.tar.gz" "design.chainlesschain.com" 200 || rc=1
deploy_one "deploy-www.tar.gz"    "www.chainlesschain.com"    10  || rc=1

echo "=== STAMP=$STAMP  rc=$rc ==="
df -h /www | tail -1
exit $rc
