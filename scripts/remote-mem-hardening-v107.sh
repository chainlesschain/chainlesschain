#!/bin/bash
# Memory-hardening: persist container mem limits into compose files,
# fix marketplace JVM heap, disable+remove orphan gc-onlyoffice.
set -u
STAMP=$(date +%Y%m%d-%H%M%S)

insert_after_line() { # file lineno text
  python3 - "$1" "$2" "$3" <<'PY'
import sys
f, ln, text = sys.argv[1], int(sys.argv[2]), sys.argv[3]
lines = open(f, encoding="utf-8").read().splitlines(keepends=True)
if any(text.strip() in l for l in lines[ln-1:ln+12]):
    print(f"skip (exists): {f}:{ln}")
else:
    lines.insert(ln, text + "\n")
    open(f, "w", encoding="utf-8").writelines(lines)
    print(f"inserted: {f}:{ln} {text.strip()}")
PY
}

echo "=== backups ==="
for f in /opt/plugin-marketplace/docker-compose.yml \
         /www/wwwroot/gz.chainlesschain.com/compose.prod.yml \
         /opt/cc-signaling-relay/docker-compose.yml \
         /opt/cc-turn/docker-compose.yml \
         /www/wwwroot/gc-web/docker-compose.yml; do
  cp "$f" "$f.bak-$STAMP" && echo "backup $f.bak-$STAMP"
done

echo "=== marketplace compose (insert bottom-up to keep line numbers) ==="
F=/opt/plugin-marketplace/docker-compose.yml
sed -i 's/JAVA_OPTS: -Xms512m -Xmx1024m -XX:+UseG1GC/JAVA_OPTS: -Xms256m -Xmx512m -XX:+UseG1GC/' "$F" && echo "JAVA_OPTS -> Xmx512m"
insert_after_line "$F" 54 "    mem_limit: 1g"
insert_after_line "$F" 36 "    mem_limit: 512m"
insert_after_line "$F" 21 "    mem_limit: 256m"
insert_after_line "$F" 2  "    mem_limit: 512m"

echo "=== ai-wm compose ==="
F=/www/wwwroot/gz.chainlesschain.com/compose.prod.yml
insert_after_line "$F" 39 "    mem_limit: 1g"
insert_after_line "$F" 10 "    mem_limit: 768m"

echo "=== signaling relay ==="
insert_after_line /opt/cc-signaling-relay/docker-compose.yml 2 "    mem_limit: 256m"

echo "=== coturn ==="
insert_after_line /opt/cc-turn/docker-compose.yml 2 "    mem_limit: 256m"

echo "=== gc-web: disable onlyoffice service (profiles) ==="
insert_after_line /www/wwwroot/gc-web/docker-compose.yml 4 '    profiles: ["disabled"]'

echo "=== validate all compose files ==="
FAIL=0
for d in /opt/plugin-marketplace /opt/cc-signaling-relay /opt/cc-turn /www/wwwroot/gc-web; do
  (cd "$d" && docker compose config -q) && echo "OK $d" || { echo "INVALID $d"; FAIL=1; }
done
(cd /www/wwwroot/gz.chainlesschain.com && docker compose -f compose.prod.yml config -q) && echo "OK gz" || { echo "INVALID gz"; FAIL=1; }
if [ "$FAIL" = "1" ]; then echo "VALIDATION FAILED - restoring backups"; for f in /opt/plugin-marketplace/docker-compose.yml /www/wwwroot/gz.chainlesschain.com/compose.prod.yml /opt/cc-signaling-relay/docker-compose.yml /opt/cc-turn/docker-compose.yml /www/wwwroot/gc-web/docker-compose.yml; do cp "$f.bak-$STAMP" "$f"; done; exit 1; fi

echo "=== recreate marketplace-service (apply Xmx512m + mem_limit) ==="
(cd /opt/plugin-marketplace && docker compose up -d marketplace-service) && sleep 12 && docker ps --format "{{.Names}} {{.Status}}" | grep marketplace-service

echo "=== remove orphan gc-onlyoffice ==="
docker rm gc-onlyoffice && echo "gc-onlyoffice removed (compose service now behind 'disabled' profile)"

echo "=== final state ==="
free -h | head -2
for c in plugin-marketplace-service marketplace-postgres marketplace-minio marketplace-redis ai-wm-web-b ai-wm-postgres-prod cc-signaling-relay cc-coturn; do
  echo "$c mem=$(docker inspect $c --format '{{.HostConfig.Memory}}' 2>/dev/null)"
done
