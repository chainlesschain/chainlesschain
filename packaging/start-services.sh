#!/bin/bash

# ChainlessChain 后端服务启动脚本
# 适用于 Linux 和 macOS

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.production.yml"

echo "========================================="
echo " ChainlessChain Backend Services"
echo "========================================="
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed"
    echo "Please install Docker from: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Error: Docker Compose is not installed"
    echo "Please install Docker Compose from: https://docs.docker.com/compose/install/"
    exit 1
fi

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running"
    echo "Please start Docker and try again"
    exit 1
fi

echo "✅ Docker is running"
echo ""

# 检查配置文件
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ Error: docker-compose.production.yml not found"
    echo "Expected location: $COMPOSE_FILE"
    exit 1
fi

# 启动服务
echo "🚀 Starting services..."
echo ""

cd "$SCRIPT_DIR"

# 使用 docker-compose 或 docker compose (取决于版本)
if command -v docker-compose &> /dev/null; then
    docker-compose -f docker-compose.production.yml up -d
else
    docker compose -f docker-compose.production.yml up -d
fi

echo ""
echo "========================================="
echo "✅ Services started successfully!"
echo "========================================="
echo ""
echo "Services:"
echo "  - PostgreSQL:  localhost:5432"
echo "  - Redis:       localhost:6379"
echo "  - Qdrant:      localhost:6333"
echo "  - Ollama:      http://localhost:11434"
echo ""
echo "Management commands:"
echo "  Stop services:   docker-compose -f docker-compose.production.yml down"
echo "  View logs:       docker-compose -f docker-compose.production.yml logs -f"
echo "  Check status:    docker-compose -f docker-compose.production.yml ps"
echo "  Restart service: docker-compose -f docker-compose.production.yml restart [service]"
echo ""
echo "First-time setup:"
echo "  1. Wait ~30 seconds for all services to start"
echo "  2. Pull Ollama model: docker exec -it chainlesschain-ollama ollama pull qwen2:7b"
echo "  3. Launch ChainlessChain desktop app"
echo ""
echo "========================================="
