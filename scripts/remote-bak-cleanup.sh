#!/usr/bin/env bash
# Clean up old /www/wwwroot/<site>.chainlesschain.com.bak-<stamp> rollback dirs.
#
# Dynamic logic: per site, KEEP the N newest .bak by mtime (the current rollback
# point(s)) and DELETE the rest — with a keeper-exists guard so a site is never
# left with zero rollback points. Reusable across releases: no hardcoded date
# prefix (the old version pinned `bak-20260609-`, which silently kept nothing on
# any later date). Pairs with scripts/remote-deploy-docs.sh.
#
# Usage:
#   scripts/remote-bak-cleanup.sh [site ...]            # keep newest 1 per site
#   KEEP_N=2 scripts/remote-bak-cleanup.sh docs         # keep newest 2, docs only
#   DRY_RUN=1 scripts/remote-bak-cleanup.sh             # preview, delete nothing
#   scripts/remote-bak-cleanup.sh design www            # only those two sites
#
#   site   one or more of: docs design www  (default: all three)
#
# Env overrides: DOCS_DEPLOY_SERVER, DOCS_DEPLOY_WROOT, KEEP_N, DRY_RUN.
# Requires OpenSSH key-auth to the server (see memory deploy_putty_fallback_no_paramiko).
set -u

SERVER="${DOCS_DEPLOY_SERVER:-root@47.111.5.128}"
WROOT="${DOCS_DEPLOY_WROOT:-/www/wwwroot}"
KEEP_N="${KEEP_N:-1}"
DRY_RUN="${DRY_RUN:-0}"

SITES=("$@")
[ "${#SITES[@]}" -eq 0 ] && SITES=(docs design www)

case "$KEEP_N" in
  ''|*[!0-9]*) echo "KEEP_N must be a non-negative integer (got '$KEEP_N')" >&2; exit 2;;
esac
[ "$KEEP_N" -lt 1 ] && { echo "KEEP_N must be >= 1 (refusing to delete every rollback point)" >&2; exit 2; }

echo "Server : $SERVER"
echo "WRoot  : $WROOT"
echo "Keep   : $KEEP_N newest .bak per site"
echo "Sites  : ${SITES[*]}"
[ "$DRY_RUN" = 1 ] && echo "MODE   : DRY-RUN (nothing will be deleted)"
echo

# Remote payload: positional args = WROOT KEEP_N DRY_RUN site...; heredoc is the
# script body (single-quoted → no local expansion, all values arrive as args).
ssh "$SERVER" "bash -s" "$WROOT" "$KEEP_N" "$DRY_RUN" "${SITES[@]}" <<'REMOTE'
set -u
WROOT="$1"; KEEP_N="$2"; DRY_RUN="$3"; shift 3
SITES=("$@")

echo "=== df BEFORE ==="; df -h "$WROOT" | tail -1
for s in "${SITES[@]}"; do
  base="$WROOT/$s.chainlesschain.com"
  mapfile -t baks < <(ls -1dt "$base".bak-* 2>/dev/null)
  if [ "${#baks[@]}" -eq 0 ]; then echo "[$s] no .bak — skip"; continue; fi

  keep=("${baks[@]:0:KEEP_N}")
  del=("${baks[@]:KEEP_N}")
  # Guard: never proceed without at least one resolved keeper.
  if [ "${#keep[@]}" -eq 0 ]; then echo "[$s] WARN: no keeper resolved — skip (safety)"; continue; fi

  echo "[$s] KEEP ${#keep[@]}: $(for k in "${keep[@]}"; do basename "$k"; done | tr '\n' ' ')"
  for d in ${del[@]+"${del[@]}"}; do
    [ -d "$d" ] || continue
    sz=$(du -sh "$d" 2>/dev/null | cut -f1)
    if [ "$DRY_RUN" = 1 ]; then
      echo "   would delete ($sz) $(basename "$d")"
    else
      rm -rf "$d" && echo "   deleted ($sz) $(basename "$d")"
    fi
  done
  # Verify keepers survived.
  for k in "${keep[@]}"; do
    [ -d "$k" ] || echo "   WARN keeper missing after cleanup: $k"
  done
done
echo "=== df AFTER ==="; df -h "$WROOT" | tail -1
echo "=== remaining .bak ==="; ls -1d "$WROOT"/*.bak-* 2>/dev/null || echo "(none)"
REMOTE
