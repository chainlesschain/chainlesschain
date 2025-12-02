#!/bin/bash

echo "========================================"
echo "U盾/SIMKey厂家管理系统 - 快速启动"
echo "========================================"
echo ""

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo "[错误] 未检测到Docker，请先安装Docker"
    echo "安装文档: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "[1/4] 停止旧容器..."
docker-compose down > /dev/null 2>&1

echo "[2/4] 构建镜像..."
docker-compose build

echo "[3/4] 启动服务..."
docker-compose up -d

echo "[4/4] 等待服务就绪..."
sleep 30

echo ""
echo "========================================"
echo "🎉 系统启动成功!"
echo "========================================"
echo ""
echo "📱 前端管理界面: http://localhost"
echo "📚 API文档: http://localhost:8080/api/swagger-ui.html"
echo "👤 默认账号: admin"
echo "🔑 默认密码: admin123456"
echo ""
echo "查看日志: docker-compose logs -f"
echo "停止服务: docker-compose down"
echo ""
