#!/usr/bin/env bash
# Prune old per-site .bak directories on the server, keeping ONLY the current
# rollback point (.bak-20260618-v120). Run remotely via ssh.
set -u
WROOT=/www/wwwroot
KEEP="20260618-v120"

echo "=== disk before ==="; df -h /www 2>/dev/null | tail -1

for site in docs.chainlesschain.com design.chainlesschain.com www.chainlesschain.com; do
  echo "--- $site ---"
  # Safety: confirm the keeper exists before pruning anything for this site.
  if [ ! -d "$WROOT/$site.bak-$KEEP" ]; then
    echo "  SKIP $site: keeper $site.bak-$KEEP missing — refusing to prune"
    continue
  fi
  for d in "$WROOT/$site".bak-*; do
    [ -d "$d" ] || continue
    if [ "$d" = "$WROOT/$site.bak-$KEEP" ]; then
      echo "  KEEP  $d"
    else
      echo "  RM    $d"
      rm -rf "$d"
    fi
  done
done

echo "=== disk after ==="; df -h /www 2>/dev/null | tail -1
echo "=== remaining .bak dirs ==="; ls -d "$WROOT"/*.bak-* 2>/dev/null
echo "=== DONE ==="
