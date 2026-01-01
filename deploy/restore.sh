#!/bin/bash

##############################################
# ChainlessChain 数据恢复脚本
# 用途: 从备份恢复PostgreSQL、项目文件、Qdrant
# 使用: ./restore.sh YYYYMMDD_HHMMSS
# 示例: ./restore.sh 20250101_020000
##############################################

set -e

# 检查参数
if [ -z "$1" ]; then
    echo "错误: 请指定备份时间戳"
    echo "使用方法: $0 YYYYMMDD_HHMMSS"
    echo ""
    echo "可用的备份:"
    ls -1 /backup/chainlesschain/ | grep -E "^(postgres|projects|qdrant)_[0-9]{8}_[0-9]{6}" | sed 's/_.*//' | sort -u
    exit 1
fi

BACKUP_TIMESTAMP=$1
BACKUP_DIR="${BACKUP_DIR:-/backup/chainlesschain}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

# 加载环境变量
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 检查备份文件是否存在
POSTGRES_BACKUP="$BACKUP_DIR/postgres_$BACKUP_TIMESTAMP.sql.gz"
PROJECTS_BACKUP="$BACKUP_DIR/projects_$BACKUP_TIMESTAMP.tar.gz"
QDRANT_BACKUP="$BACKUP_DIR/qdrant_$BACKUP_TIMESTAMP.tar.gz"

echo "========================================="
echo "ChainlessChain 数据恢复"
echo "备份时间: $BACKUP_TIMESTAMP"
echo "========================================="

# 确认操作
echo ""
echo "警告: 此操作将覆盖现有数据！"
echo "即将恢复以下备份:"
[ -f "$POSTGRES_BACKUP" ] && echo "  ✓ PostgreSQL: $POSTGRES_BACKUP"
[ -f "$PROJECTS_BACKUP" ] && echo "  ✓ 项目文件: $PROJECTS_BACKUP"
[ -f "$QDRANT_BACKUP" ] && echo "  ✓ Qdrant: $QDRANT_BACKUP"
echo ""
read -p "是否继续? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "恢复已取消"
    exit 0
fi

# 1. 停止服务
echo ""
echo "[1/5] 停止服务..."
docker-compose -f "$COMPOSE_FILE" down
echo "✓ 服务已停止"

# 2. 恢复PostgreSQL
if [ -f "$POSTGRES_BACKUP" ]; then
    echo ""
    echo "[2/5] 恢复PostgreSQL数据库..."

    # 临时启动PostgreSQL
    docker-compose -f "$COMPOSE_FILE" up -d postgres
    sleep 10

    # 等待PostgreSQL就绪
    until docker exec chainlesschain_postgres pg_isready -U "${DB_USER:-chainlesschain}" > /dev/null 2>&1; do
        echo "等待PostgreSQL启动..."
        sleep 2
    done

    # 恢复数据
    gunzip < "$POSTGRES_BACKUP" | docker exec -i chainlesschain_postgres psql \
        -U "${DB_USER:-chainlesschain}" \
        -d "${DB_NAME:-chainlesschain}"

    echo "✓ PostgreSQL恢复完成"

    # 停止临时PostgreSQL
    docker-compose -f "$COMPOSE_FILE" stop postgres
else
    echo ""
    echo "[2/5] ⚠ PostgreSQL备份不存在，跳过"
fi

# 3. 恢复项目文件
if [ -f "$PROJECTS_BACKUP" ]; then
    echo ""
    echo "[3/5] 恢复项目文件..."

    # 备份当前数据
    if [ -d "./data/projects" ]; then
        mv ./data/projects "./data/projects.bak.$(date +%s)"
    fi

    # 恢复
    mkdir -p ./data
    tar -xzf "$PROJECTS_BACKUP" -C ./

    echo "✓ 项目文件恢复完成"
else
    echo ""
    echo "[3/5] ⚠ 项目文件备份不存在，跳过"
fi

# 4. 恢复Qdrant
if [ -f "$QDRANT_BACKUP" ]; then
    echo ""
    echo "[4/5] 恢复Qdrant向量数据..."

    # 备份当前数据
    if [ -d "./data/qdrant" ]; then
        mv ./data/qdrant "./data/qdrant.bak.$(date +%s)"
    fi

    # 恢复
    mkdir -p ./data
    tar -xzf "$QDRANT_BACKUP" -C ./

    echo "✓ Qdrant恢复完成"
else
    echo ""
    echo "[4/5] ⚠ Qdrant备份不存在，跳过"
fi

# 5. 重启所有服务
echo ""
echo "[5/5] 重启所有服务..."
docker-compose -f "$COMPOSE_FILE" up -d

# 等待服务就绪
echo "等待服务启动..."
sleep 20

# 健康检查
echo ""
echo "检查服务状态..."
docker-compose -f "$COMPOSE_FILE" ps

echo ""
echo "========================================="
echo "数据恢复完成"
echo "时间: $(date)"
echo "========================================="

exit 0
