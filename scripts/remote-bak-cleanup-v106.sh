#!/bin/bash
# Prune old <site>.bak-<ts> dirs, keeping ONLY the just-deployed v5.0.3.106
# rollback trio (bak-20260611-153957). Prints a delete plan (du each) first,
# then deletes, with df before/after.
set -u
KEEP=bak-20260611-162859
SITES="docs.chainlesschain.com design.chainlesschain.com www.chainlesschain.com"

echo "=== BEFORE: df / ==="
df -h / | tail -1

echo "=== DELETE PLAN (keep $KEEP per site) ==="
for s in $SITES; do
  for d in /www/wwwroot/$s.bak-*; do
    [ -d "$d" ] || continue
    base=$(basename "$d")
    if [ "$base" = "$s.$KEEP" ]; then
      echo "KEEP   $(du -sh "$d" | cut -f1)  $d"
    else
      echo "DELETE $(du -sh "$d" | cut -f1)  $d"
    fi
  done
done

echo "=== EXECUTING ==="
for s in $SITES; do
  for d in /www/wwwroot/$s.bak-*; do
    [ -d "$d" ] || continue
    base=$(basename "$d")
    if [ "$base" != "$s.$KEEP" ]; then
      rm -rf "$d" && echo "DELETED $d"
    fi
  done
done

echo "=== AFTER: df / ==="
df -h / | tail -1
echo "=== remaining .bak ==="
du -sch /www/wwwroot/*.chainlesschain.com.bak-* 2>/dev/null | tail -1
ls -d /www/wwwroot/*.chainlesschain.com.bak-* 2>/dev/null
