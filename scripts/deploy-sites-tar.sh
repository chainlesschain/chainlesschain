#!/bin/bash
# Deploy chainlesschain sites to 47.111.5.128 without rsync (Windows Git Bash safe).
# Strategy per site: tar | ssh into <docroot>.new, then atomic swap keeping <docroot>.old
# as rollback. Replicates rsync --delete (fresh tree) but reversible.
#
# Usage: deploy-sites-tar.sh [official|user|design ...]   (default: all three)
set -euo pipefail

SERVER="root@47.111.5.128"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no)

# name -> "localdist|remotedocroot"
declare -A SITES=(
  [official]="$ROOT/docs-website-v2/dist|/www/wwwroot/www.chainlesschain.com"
  [user]="$ROOT/docs-site/docs/.vitepress/dist|/www/wwwroot/docs.chainlesschain.com"
  [design]="$ROOT/docs-site-design/docs/.vitepress/dist|/www/wwwroot/design.chainlesschain.com"
)

targets=("$@"); [ ${#targets[@]} -eq 0 ] && targets=(official user design)

deploy_one() {
  local name="$1"
  local spec="${SITES[$name]:-}"
  [ -z "$spec" ] && { echo "!! unknown site: $name"; return 1; }
  local dist="${spec%%|*}" remote="${spec##*|}"

  echo "==> [$name] $dist  ->  $SERVER:$remote"
  [ -f "$dist/index.html" ] || { echo "!! no index.html in $dist — build first"; return 1; }
  local nfiles; nfiles=$(find "$dist" -type f | wc -l)
  echo "    local files: $nfiles"

  # 1) upload into <remote>.new (clean)
  ssh "${SSH_OPTS[@]}" "$SERVER" "rm -rf '$remote.new' && mkdir -p '$remote.new'"
  tar czf - -C "$dist" . | ssh "${SSH_OPTS[@]}" "$SERVER" "tar xzf - -C '$remote.new'"

  # 2) sanity-check remote extraction
  local rfiles; rfiles=$(ssh "${SSH_OPTS[@]}" "$SERVER" "test -f '$remote.new/index.html' && find '$remote.new' -type f | wc -l || echo 0")
  echo "    remote files: $rfiles"
  [ "$rfiles" -ge 1 ] || { echo "!! remote extraction failed"; ssh "${SSH_OPTS[@]}" "$SERVER" "rm -rf '$remote.new'"; return 1; }

  # 3) atomic swap, keep .old as rollback
  ssh "${SSH_OPTS[@]}" "$SERVER" "rm -rf '$remote.old'; if [ -e '$remote' ]; then mv '$remote' '$remote.old'; fi; mv '$remote.new' '$remote'"
  echo "    ✅ [$name] live ($rfiles files); rollback at $remote.old"
}

for t in "${targets[@]}"; do deploy_one "$t"; done
echo "✅ deploy done: ${targets[*]}"
