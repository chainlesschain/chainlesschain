#!/bin/bash

##############################################
# ChainlessChain 数据备份脚本
# 用途: 备份PostgreSQL、项目文件、Qdrant向量数据
# 使用: ./backup.sh
##############################################

set -e

# 配置
BACKUP_DIR="${BACKUP_DIR:-/backup/chainlesschain}"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=${RETENTION_DAYS:-30}
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

# 加载环境变量
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 创建备份目录
mkdir -p "$BACKUP_DIR"

echo "========================================="
echo "ChainlessChain 备份开始"
echo "时间: $(date)"
echo "========================================="

# 1. 备份PostgreSQL
echo ""
echo "[1/4] 备份PostgreSQL数据库..."
POSTGRES_BACKUP="$BACKUP_DIR/postgres_$DATE.sql.gz"
docker exec chainlesschain_postgres pg_dump \
    -U "${DB_USER:-chainlesschain}" \
    -d "${DB_NAME:-chainlesschain}" \
    --clean --if-exists \
    | gzip > "$POSTGRES_BACKUP"

if [ -f "$POSTGRES_BACKUP" ]; then
    SIZE=$(du -h "$POSTGRES_BACKUP" | cut -f1)
    echo "✓ PostgreSQL备份完成: $POSTGRES_BACKUP ($SIZE)"
else
    echo "✗ PostgreSQL备份失败"
    exit 1
fi

# 2. 备份项目文件
echo ""
echo "[2/4] 备份项目文件..."
PROJECTS_BACKUP="$BACKUP_DIR/projects_$DATE.tar.gz"
if [ -d "./data/projects" ]; then
    tar -czf "$PROJECTS_BACKUP" ./data/projects 2>/dev/null || true
    if [ -f "$PROJECTS_BACKUP" ]; then
        SIZE=$(du -h "$PROJECTS_BACKUP" | cut -f1)
        echo "✓ 项目文件备份完成: $PROJECTS_BACKUP ($SIZE)"
    else
        echo "⚠ 项目文件备份失败或目录为空"
    fi
else
    echo "⚠ 项目文件目录不存在，跳过"
fi

# 3. 备份Qdrant向量数据
echo ""
echo "[3/4] 备份Qdrant向量数据..."
QDRANT_BACKUP="$BACKUP_DIR/qdrant_$DATE.tar.gz"
if [ -d "./data/qdrant" ]; then
    tar -czf "$QDRANT_BACKUP" ./data/qdrant 2>/dev/null || true
    if [ -f "$QDRANT_BACKUP" ]; then
        SIZE=$(du -h "$QDRANT_BACKUP" | cut -f1)
        echo "✓ Qdrant备份完成: $QDRANT_BACKUP ($SIZE)"
    else
        echo "⚠ Qdrant备份失败或目录为空"
    fi
else
    echo "⚠ Qdrant数据目录不存在，跳过"
fi

# 4. 备份环境配置
echo ""
echo "[4/4] 备份环境配置..."
CONFIG_BACKUP="$BACKUP_DIR/config_$DATE.tar.gz"
tar -czf "$CONFIG_BACKUP" .env docker-compose*.yml 2>/dev/null || true
if [ -f "$CONFIG_BACKUP" ]; then
    SIZE=$(du -h "$CONFIG_BACKUP" | cut -f1)
    echo "✓ 配置文件备份完成: $CONFIG_BACKUP ($SIZE)"
else
    echo "⚠ 配置文件备份失败"
fi

# 5. 清理过期备份
echo ""
echo "清理 $RETENTION_DAYS 天前的备份..."
DELETED=$(find "$BACKUP_DIR" -name "*.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo "✓ 已删除 $DELETED 个过期备份文件"

# 6. 生成备份清单
echo ""
echo "备份清单:"
ls -lh "$BACKUP_DIR" | grep "$DATE"

# 7. 统计备份大小
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "========================================="
echo "备份完成"
echo "备份目录: $BACKUP_DIR"
echo "总大小: $TOTAL_SIZE"
echo "时间: $(date)"
echo "========================================="

# 可选：上传到云存储（取消注释并配置）
# echo ""
# echo "上传备份到云存储..."
# if command -v aws &> /dev/null; then
#     aws s3 sync "$BACKUP_DIR" s3://your-bucket/chainlesschain-backups/
#     echo "✓ 已上传到AWS S3"
# elif command -v aliyun &> /dev/null; then
#     aliyun oss cp "$BACKUP_DIR" oss://your-bucket/chainlesschain-backups/ -r
#     echo "✓ 已上传到阿里云OSS"
# fi

exit 0
