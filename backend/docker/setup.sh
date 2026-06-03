#!/bin/bash

# ChainlessChain AI服务初始化脚本

set -e

echo "======================================"
echo "ChainlessChain AI服务初始化"
echo "======================================"
echo ""

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo "错误: 未检测到Docker,请先安装Docker"
    exit 1
fi

# 检查Docker Compose是否安装
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "错误: 未检测到Docker Compose,请先安装Docker Compose"
    exit 1
fi

echo "[1/5] 启动Docker服务..."
docker-compose up -d

echo ""
echo "[2/5] 等待服务就绪..."
sleep 10

echo ""
echo "[3/5] 检查Ollama连接..."
if curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "✓ Ollama服务已就绪"
else
    echo "✗ Ollama服务未就绪,请检查Docker日志"
fi

echo ""
echo "[4/5] 下载推荐模型..."
echo "正在下载 qwen2:7b (这可能需要几分钟)..."
docker exec chainlesschain-ollama ollama pull qwen2:7b || echo "模型下载失败,请稍后手动执行: ollama pull qwen2:7b"

echo ""
echo "正在下载 nomic-embed-text (Embedding模型)..."
docker exec chainlesschain-ollama ollama pull nomic-embed-text || echo "模型下载失败,请稍后手动执行: ollama pull nomic-embed-text"

echo ""
echo "[5/5] 初始化向量数据库..."
# 创建知识库集合
curl -X PUT 'http://localhost:6333/collections/knowledge_base' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }' || echo "集合创建失败,可能已存在"

echo ""
echo "======================================"
echo "初始化完成!"
echo "======================================"
echo ""
echo "服务状态:"
echo "  - Ollama LLM:     http://localhost:11434"
echo "  - Qdrant向量DB:   http://localhost:6333"
echo "  - AnythingLLM:    http://localhost:3001"
echo "  - Gitea Git:      http://localhost:3000"
echo ""
echo "常用命令:"
echo "  - 查看日志: docker-compose logs -f"
echo "  - 停止服务: docker-compose down"
echo "  - 重启服务: docker-compose restart"
echo ""
echo "测试Ollama:"
echo "  curl http://localhost:11434/api/generate -d '{\"model\":\"qwen2:7b\",\"prompt\":\"你好\",\"stream\":false}'"
echo ""
