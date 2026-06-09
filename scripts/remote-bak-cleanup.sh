#!/usr/bin/env bash
# Clean up OLD /www/wwwroot/<site>.bak-<ts> dirs.
# KEEP all of today's (bak-20260609-*) — they include the current live rollback
# targets per site. DELETE everything older (bak-20260530 / 0603 / 0608).
set -u
KEEP_PREFIX="bak-20260609-"

echo "=== df BEFORE ==="; df -h /www | tail -1

echo "=== DELETE PLAN (everything NOT matching $KEEP_PREFIX) ==="
to_delete=()
for d in /www/wwwroot/*.bak-*; do
  [ -d "$d" ] || continue
  case "$(basename "$d")" in
    *".$KEEP_PREFIX"*) echo "  KEEP   $d";;
    *) echo "  DELETE $(du -sh "$d" | cut -f1)  $d"; to_delete+=("$d");;
  esac
done

echo "=== executing (${#to_delete[@]} dirs) ==="
for d in "${to_delete[@]}"; do
  rm -rf "$d" && echo "  deleted $d"
done

echo "=== df AFTER ==="; df -h /www | tail -1
echo "=== remaining .bak ==="; du -sch /www/wwwroot/*.bak-* 2>/dev/null | tail -1
