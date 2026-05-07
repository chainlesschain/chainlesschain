#!/bin/sh
# 插件市场数据库幂等初始化
# 1. 在共享 postgres 实例里建 plugin_marketplace 库（如果还没有）
# 2. 跑 schema.sql（仅当 plugins 表不存在时）
# 容器入口脚本，由 docker-compose marketplace-db-init service 调用
set -e

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-chainlesschain}"
DB_NAME="${DB_NAME:-plugin_marketplace}"
SCHEMA_FILE="${SCHEMA_FILE:-/schema.sql}"

if [ -z "$PGPASSWORD" ]; then
  echo "[init] ERROR: PGPASSWORD must be set" >&2
  exit 1
fi
export PGPASSWORD

echo "[init] Waiting for postgres at $PGHOST..."
ATTEMPT=0
until psql -h "$PGHOST" -U "$PGUSER" -d postgres -c '\q' 2>/dev/null; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -gt 30 ]; then
    echo "[init] ERROR: postgres not reachable after 60s" >&2
    exit 1
  fi
  sleep 2
done
echo "[init] postgres reachable"

EXISTS=$(psql -h "$PGHOST" -U "$PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")
if [ "$EXISTS" != "1" ]; then
  echo "[init] Creating database $DB_NAME..."
  psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "CREATE DATABASE $DB_NAME OWNER $PGUSER;"
else
  echo "[init] Database $DB_NAME already exists"
fi

HAS_TABLE=$(psql -h "$PGHOST" -U "$PGUSER" -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='plugins' LIMIT 1")
if [ "$HAS_TABLE" != "1" ]; then
  echo "[init] Applying schema.sql..."
  psql -h "$PGHOST" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$SCHEMA_FILE"
  echo "[init] Schema applied"
else
  echo "[init] Schema already present (plugins table exists), skipping"
fi

echo "[init] Done."
