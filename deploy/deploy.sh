#!/bin/bash

##############################################
# ChainlessChain 一键部署脚本
# 用途: 自动化部署流程
# 使用: ./deploy.sh [mode]
# 模式: production (生产), cloud (纯云端), local (本地开发)
##############################################

set -e

# 默认模式
MODE=${1:-production}

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════╗
║   ChainlessChain 自动部署工具        ║
║   Cloud Deployment Script v1.0       ║
╚═══════════════════════════════════════╝
EOF
echo -e "${NC}"

# 选择docker-compose文件
case $MODE in
    production)
        COMPOSE_FILE="docker-compose.production.yml"
        echo -e "${GREEN}部署模式: 生产环境（云LLM + 安全加固）${NC}"
        ;;
    cloud)
        COMPOSE_FILE="docker-compose.cloud.yml"
        echo -e "${GREEN}部署模式: 云端模式（仅云LLM）${NC}"
        ;;
    local)
        COMPOSE_FILE="docker-compose.yml"
        echo -e "${GREEN}部署模式: 本地开发（含Ollama）${NC}"
        ;;
    *)
        echo -e "${RED}错误: 未知模式 '$MODE'${NC}"
        echo "可用模式: production, cloud, local"
        exit 1
        ;;
esac

echo ""
echo "========================================="
echo "步骤 1/6: 环境检查"
echo "========================================="

# 检查Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker已安装: $(docker --version)${NC}"

# 检查Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose已安装: $(docker-compose --version)${NC}"

# 检查.env文件
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠ .env文件不存在，从.env.example创建${NC}"
    cp .env.example .env
    echo -e "${RED}请编辑 .env 文件配置必要的环境变量（数据库密码、API密钥等）${NC}"
    echo -e "${RED}编辑完成后重新运行此脚本${NC}"
    exit 1
fi
echo -e "${GREEN}✓ .env配置文件存在${NC}"

# 检查关键环境变量
echo ""
echo "检查关键环境变量..."
source .env

# 检查数据库密码
if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" == "chainlesschain_pwd_2024" ]; then
    echo -e "${YELLOW}⚠ 警告: 请修改默认数据库密码${NC}"
fi

# 检查Redis密码
if [ -z "$REDIS_PASSWORD" ] || [ "$REDIS_PASSWORD" == "chainlesschain_redis_2024" ]; then
    echo -e "${YELLOW}⚠ 警告: 请修改默认Redis密码${NC}"
fi

# 检查LLM配置（生产模式必需）
if [ "$MODE" == "production" ] || [ "$MODE" == "cloud" ]; then
    if [ -z "$LLM_PROVIDER" ]; then
        echo -e "${RED}✗ 错误: 未设置LLM_PROVIDER${NC}"
        exit 1
    fi

    case $LLM_PROVIDER in
        dashscope)
            if [ -z "$DASHSCOPE_API_KEY" ]; then
                echo -e "${RED}✗ 错误: 未设置DASHSCOPE_API_KEY${NC}"
                exit 1
            fi
            ;;
        openai)
            if [ -z "$OPENAI_API_KEY" ]; then
                echo -e "${RED}✗ 错误: 未设置OPENAI_API_KEY${NC}"
                exit 1
            fi
            ;;
        zhipu)
            if [ -z "$ZHIPU_API_KEY" ]; then
                echo -e "${RED}✗ 错误: 未设置ZHIPU_API_KEY${NC}"
                exit 1
            fi
            ;;
    esac
    echo -e "${GREEN}✓ LLM配置: $LLM_PROVIDER${NC}"
fi

# 检查JWT密钥
if [ "$MODE" == "production" ]; then
    if [ -z "$JWT_SECRET" ] || [ ${#JWT_SECRET} -lt 32 ]; then
        echo -e "${RED}✗ 错误: JWT_SECRET未设置或长度不足32位${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ JWT密钥已配置${NC}"
fi

echo ""
echo "========================================="
echo "步骤 2/6: 创建数据目录"
echo "========================================="

mkdir -p data/{postgres,redis,qdrant,projects,models}
mkdir -p logs/{postgres,redis,ai-service,project-service}

echo -e "${GREEN}✓ 数据目录创建完成${NC}"

echo ""
echo "========================================="
echo "步骤 3/6: 拉取Docker镜像"
echo "========================================="

docker-compose -f $COMPOSE_FILE pull

echo ""
echo "========================================="
echo "步骤 4/6: 构建应用镜像"
echo "========================================="

docker-compose -f $COMPOSE_FILE build --no-cache

echo ""
echo "========================================="
echo "步骤 5/6: 启动服务"
echo "========================================="

# 停止现有服务
if docker-compose -f $COMPOSE_FILE ps -q 2>/dev/null | grep -q .; then
    echo "停止现有服务..."
    docker-compose -f $COMPOSE_FILE down
fi

# 启动服务
echo "启动新服务..."
docker-compose -f $COMPOSE_FILE up -d

echo ""
echo "等待服务启动..."
sleep 15

# 查看服务状态
docker-compose -f $COMPOSE_FILE ps

echo ""
echo "========================================="
echo "步骤 6/6: 健康检查"
echo "========================================="

# 等待服务完全启动
echo "等待服务完全启动（最多60秒）..."
TIMEOUT=60
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    AI_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/health 2>/dev/null || echo "000")
    PROJECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:9090/actuator/health 2>/dev/null || echo "000")

    if [ "$AI_STATUS" == "200" ] && [ "$PROJECT_STATUS" == "200" ]; then
        echo -e "${GREEN}✓ 所有服务已就绪${NC}"
        break
    fi

    echo -n "."
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo -e "${YELLOW}⚠ 部分服务可能未完全启动，请手动检查${NC}"
fi

# 运行完整健康检查
if [ -f ./deploy/health-check.sh ]; then
    echo ""
    bash ./deploy/health-check.sh
fi

echo ""
echo "========================================="
echo -e "${GREEN}部署完成！${NC}"
echo "========================================="
echo ""
echo "服务访问地址:"
echo "  - AI服务: http://localhost:8001"
echo "  - Project服务: http://localhost:9090"
echo "  - API文档: http://localhost:9090/swagger-ui.html"
echo ""
echo "查看日志:"
echo "  docker-compose -f $COMPOSE_FILE logs -f"
echo ""
echo "停止服务:"
echo "  docker-compose -f $COMPOSE_FILE down"
echo ""
echo "重启服务:"
echo "  docker-compose -f $COMPOSE_FILE restart"
echo ""

if [ "$MODE" == "production" ]; then
    echo -e "${YELLOW}生产环境提醒:${NC}"
    echo "  1. 配置Nginx反向代理和SSL证书（参考 DEPLOYMENT_GUIDE.md）"
    echo "  2. 配置防火墙规则"
    echo "  3. 设置定时备份（crontab -e）"
    echo "  4. 配置监控告警"
    echo ""
fi

echo "========================================="
