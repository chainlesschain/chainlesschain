#!/usr/bin/env bash
# Reusable docs-site deployer — build + tar + scp + remote atomic-swap + verify.
#
# Generalizes the one-off remote-deploy-vNNN.sh scripts (which only do the
# server-side swap of pre-uploaded tarballs) into a single local orchestrator
# that handles the whole pipeline for any subset of the three static sites.
#
# Usage:
#   scripts/remote-deploy-docs.sh [STAMP] [site ...]
#     STAMP   timestamped .bak suffix (default: YYYYmmdd-HHMM). The existing
#             release .bak (e.g. .bak-20260615-v113) is never clobbered as long
#             as you pass a distinct STAMP.
#     site    one or more of: docs design www  (default: all three)
#
# Examples:
#   scripts/remote-deploy-docs.sh                      # build+deploy all 3
#   scripts/remote-deploy-docs.sh 20260615-docfix docs # just docs, custom stamp
#   scripts/remote-deploy-docs.sh "" design www        # design+www, auto stamp
#
# Requires: OpenSSH key-auth to the server (ssh/scp, no password). See memory
# deploy_putty_fallback_no_paramiko for the PuTTY fallback when key-auth is down.
set -u

SERVER="${DOCS_DEPLOY_SERVER:-root@47.111.5.128}"
WROOT="/www/wwwroot"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STAMP="${1:-$(date +%Y%m%d-%H%M)}"
shift || true
SITES=("$@")
[ "${#SITES[@]}" -eq 0 ] && SITES=(docs design www)

# site -> "<source-dir-rel-repo>|<dist-dir-rel-source>|<domain>|<min-html>"
site_cfg() {
  case "$1" in
    docs)   echo "docs-site|docs/.vitepress/dist|docs.chainlesschain.com|500" ;;
    design) echo "docs-site-design|docs/.vitepress/dist|design.chainlesschain.com|240" ;;
    www)    echo "docs-website-v2|dist|www.chainlesschain.com|18" ;;
    *)      echo "" ;;
  esac
}

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)
fail=0

for site in "${SITES[@]}"; do
  cfg="$(site_cfg "$site")"
  if [ -z "$cfg" ]; then echo "!! unknown site: $site (want docs|design|www)"; fail=1; continue; fi
  IFS='|' read -r srcrel distrel domain minhtml <<<"$cfg"
  src="$REPO_ROOT/$srcrel"
  dist="$src/$distrel"
  tar="/tmp/deploy-$site-$STAMP.tar.gz"
  echo "===== $site -> $domain (min html $minhtml, stamp $STAMP) ====="

  # 1. build
  echo "[$site] building..."
  ( cd "$src" && npm run build ) || { echo "!! $site build failed"; fail=1; continue; }
  n=$(find "$dist" -name "*.html" | wc -l)
  echo "[$site] built $n html"
  if [ "$n" -lt "$minhtml" ]; then echo "!! $site html $n < $minhtml — skip"; fail=1; continue; fi
  [ -f "$dist/index.html" ] || { echo "!! $site missing dist/index.html — skip"; fail=1; continue; }

  # 2. tar (index.html at archive root) + scp
  ( cd "$dist" && tar czf "$tar" . ) || { echo "!! $site tar failed"; fail=1; continue; }
  scp "${SSH_OPTS[@]}" "$tar" "$SERVER:$tar" || { echo "!! $site scp failed"; fail=1; rm -f "$tar"; continue; }
  rm -f "$tar"

  # 3. remote atomic swap (preserves any other .bak)
  ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<REMOTE
set -u
dir="$WROOT/$domain"; tar="$tar"; min=$minhtml; stamp="$STAMP"
[ -f "\$tar" ] || { echo "!! missing tarball \$tar"; exit 1; }
rm -rf "\$dir.new"; mkdir -p "\$dir.new"
tar -xzf "\$tar" -C "\$dir.new"
rn=\$(find "\$dir.new" -name "*.html" | wc -l)
[ "\$rn" -ge "\$min" ] || { echo "!! ABORT \$dir: html \$rn < \$min"; rm -rf "\$dir.new"; exit 1; }
[ -f "\$dir.new/index.html" ] || { echo "!! ABORT \$dir: no index.html"; rm -rf "\$dir.new"; exit 1; }
rm -rf "\$dir.bak-\$stamp"
mv "\$dir" "\$dir.bak-\$stamp"
mv "\$dir.new" "\$dir"
chown -R www:www "\$dir" 2>/dev/null || chown -R nginx:nginx "\$dir" 2>/dev/null || true
echo "OK \$dir: \$rn html live. ROLLBACK: \$dir.bak-\$stamp"
rm -f "\$tar"
REMOTE
  if [ $? -ne 0 ]; then echo "!! $site remote swap failed"; fail=1; continue; fi

  # 4. verify live
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "https://$domain/?cb=$RANDOM")
  echo "[$site] live check: https://$domain -> HTTP $code"
  [ "$code" = "200" ] || { echo "!! $site not HTTP 200"; fail=1; }
done

echo "===== DONE (fail=$fail) ====="
exit $fail
