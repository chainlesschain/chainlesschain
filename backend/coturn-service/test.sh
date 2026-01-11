#!/bin/bash

# STUN/TURN服务器快速测试脚本

set -e

echo "ChainlessChain STUN/TURN服务器测试"
echo "===================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查Docker是否运行
echo "1. 检查Docker服务..."
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker未运行，请先启动Docker${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker正在运行${NC}"
echo ""

# 检查coturn容器是否存在
echo "2. 检查coturn容器..."
if docker ps -a | grep -q chainlesschain-coturn; then
    if docker ps | grep -q chainlesschain-coturn; then
        echo -e "${GREEN}✓ coturn容器正在运行${NC}"
    else
        echo -e "${YELLOW}⚠ coturn容器已停止，正在启动...${NC}"
        docker start chainlesschain-coturn
        sleep 3
    fi
else
    echo -e "${YELLOW}⚠ coturn容器不存在，正在创建...${NC}"
    cd "$(dirname "$0")/../.."
    docker-compose up -d coturn
    sleep 5
fi
echo ""

# 检查端口是否开放
echo "3. 检查端口..."
if command -v netstat > /dev/null 2>&1; then
    if netstat -an | grep -q ":3478"; then
        echo -e "${GREEN}✓ 端口3478已开放${NC}"
    else
        echo -e "${RED}✗ 端口3478未开放${NC}"
    fi
elif command -v lsof > /dev/null 2>&1; then
    if lsof -i :3478 > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 端口3478已开放${NC}"
    else
        echo -e "${RED}✗ 端口3478未开放${NC}"
    fi
else
    echo -e "${YELLOW}⚠ 无法检查端口状态（netstat/lsof不可用）${NC}"
fi
echo ""

# 查看coturn日志
echo "4. 查看coturn日志（最后10行）..."
echo "-----------------------------------"
docker logs --tail 10 chainlesschain-coturn 2>&1 || echo -e "${YELLOW}⚠ 无法获取日志${NC}"
echo "-----------------------------------"
echo ""

# 运行Node.js测试脚本
echo "5. 运行连接测试..."
if [ -f "$(dirname "$0")/test-stun-turn.js" ]; then
    node "$(dirname "$0")/test-stun-turn.js"
else
    echo -e "${RED}✗ 测试脚本不存在${NC}"
    exit 1
fi
echo ""

# 显示配置信息
echo "6. 配置信息"
echo "-----------------------------------"
echo "STUN服务器: stun:localhost:3478"
echo "TURN服务器: turn:localhost:3478"
echo "用户名: chainlesschain"
echo "密码: chainlesschain2024"
echo "-----------------------------------"
echo ""

# 显示下一步操作
echo "下一步操作:"
echo "1. 在桌面应用的P2P设置中配置STUN/TURN服务器"
echo "2. 如果部署到云服务器，需要:"
echo "   - 修改 turnserver.conf 中的 external-ip 为公网IP"
echo "   - 在安全组/防火墙中开放端口: 3478, 5349, 49152-49252"
echo "   - 重启coturn容器: docker-compose restart coturn"
echo "3. 测试P2P连接功能"
echo ""

echo -e "${GREEN}测试完成！${NC}"
