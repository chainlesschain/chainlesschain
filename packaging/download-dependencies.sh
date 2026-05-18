#!/bin/bash
# ChainlessChain 打包依赖下载脚本 (使用 curl)

set -e

PACKAGING_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== ChainlessChain 打包依赖下载 ==="
echo "目标目录: $PACKAGING_DIR"

# 1. 下载 JRE 17 (Eclipse Temurin)
echo ""
echo "[1/4] 下载 JRE 17..."
JRE_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jre_x64_windows_hotspot_17.0.13_11.zip"
JRE_ZIP="$PACKAGING_DIR/jre-17.zip"
JRE_DIR="$PACKAGING_DIR/jre-17"

if [ -d "$JRE_DIR" ] && [ "$(ls -A $JRE_DIR)" ]; then
    echo "  ✓ JRE 17 已存在，跳过"
else
    echo "  下载中: $JRE_URL"
    curl -L -o "$JRE_ZIP" "$JRE_URL" --progress-bar
    echo "  解压中..."
    mkdir -p "$JRE_DIR-temp"
    unzip -q "$JRE_ZIP" -d "$JRE_DIR-temp"
    # 移动到正确的目录
    mv "$JRE_DIR-temp"/*/* "$JRE_DIR/"
    rm -rf "$JRE_DIR-temp"
    rm -f "$JRE_ZIP"
    echo "  ✓ JRE 17 下载完成"
fi

# 2. 下载 PostgreSQL Portable
echo ""
echo "[2/4] 下载 PostgreSQL 16..."
PG_URL="https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip"
PG_ZIP="$PACKAGING_DIR/postgres.zip"
PG_DIR="$PACKAGING_DIR/postgres"

if [ -d "$PG_DIR" ] && [ "$(ls -A $PG_DIR)" ]; then
    echo "  ✓ PostgreSQL 已存在，跳过"
else
    echo "  下载中: $PG_URL"
    curl -L -o "$PG_ZIP" "$PG_URL" --progress-bar
    echo "  解压中..."
    mkdir -p "$PG_DIR-temp"
    unzip -q "$PG_ZIP" -d "$PG_DIR-temp"
    mv "$PG_DIR-temp/pgsql" "$PG_DIR"
    rm -rf "$PG_DIR-temp"
    rm -f "$PG_ZIP"
    echo "  ✓ PostgreSQL 下载完成"
fi

# 3. 下载 Redis for Windows
echo ""
echo "[3/4] 下载 Redis..."
REDIS_URL="https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
REDIS_ZIP="$PACKAGING_DIR/redis.zip"
REDIS_DIR="$PACKAGING_DIR/redis"

if [ -d "$REDIS_DIR" ] && [ "$(ls -A $REDIS_DIR)" ]; then
    echo "  ✓ Redis 已存在，跳过"
else
    echo "  下载中: $REDIS_URL"
    curl -L -o "$REDIS_ZIP" "$REDIS_URL" --progress-bar
    echo "  解压中..."
    mkdir -p "$REDIS_DIR"
    unzip -q "$REDIS_ZIP" -d "$REDIS_DIR"
    rm -f "$REDIS_ZIP"
    echo "  ✓ Redis 下载完成"
fi

# 4. 下载 Qdrant
echo ""
echo "[4/4] 下载 Qdrant..."
QDRANT_URL="https://github.com/qdrant/qdrant/releases/download/v1.12.5/qdrant-x86_64-pc-windows-msvc.zip"
QDRANT_ZIP="$PACKAGING_DIR/qdrant.zip"
QDRANT_DIR="$PACKAGING_DIR/qdrant"

if [ -d "$QDRANT_DIR" ] && [ "$(ls -A $QDRANT_DIR)" ]; then
    echo "  ✓ Qdrant 已存在，跳过"
else
    echo "  下载中: $QDRANT_URL"
    curl -L -o "$QDRANT_ZIP" "$QDRANT_URL" --progress-bar
    echo "  解压中..."
    mkdir -p "$QDRANT_DIR"
    unzip -q "$QDRANT_ZIP" -d "$QDRANT_DIR"
    rm -f "$QDRANT_ZIP"
    echo "  ✓ Qdrant 下载完成"
fi

echo ""
echo "=== 依赖下载完成 ==="
echo ""
echo "下载的依赖:"
echo "  ✓ JRE 17         : $JRE_DIR"
echo "  ✓ PostgreSQL 16  : $PG_DIR"
echo "  ✓ Redis 5.0.14   : $REDIS_DIR"
echo "  ✓ Qdrant 1.12.5  : $QDRANT_DIR"

# 显示目录大小
echo ""
echo "依赖大小:"
du -sh "$JRE_DIR" 2>/dev/null | awk '{print "  JRE 17      : " $1}'
du -sh "$PG_DIR" 2>/dev/null | awk '{print "  PostgreSQL  : " $1}'
du -sh "$REDIS_DIR" 2>/dev/null | awk '{print "  Redis       : " $1}'
du -sh "$QDRANT_DIR" 2>/dev/null | awk '{print "  Qdrant      : " $1}'

echo ""
echo "接下来需要:"
echo "  1. 构建 Java 项目 (project-service.jar)"
echo "     运行: cd backend/project-service && mvn clean package -DskipTests"
echo "  2. 运行打包命令"
echo "     运行: cd desktop-app-vue && npm run make:win"
