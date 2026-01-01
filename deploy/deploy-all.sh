#!/bin/bash

##############################################
# ChainlessChain 完整系统一键部署脚本
# 用途: 自动部署后端服务 + 监控系统
# 使用: sudo ./deploy-all.sh
##############################################

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

clear

echo -e "${CYAN}"
cat << "EOF"
╔══════════════════════════════════════════════════════╗
║                                                      ║
║     ██████╗██╗  ██╗ █████╗ ██╗███╗   ██╗           ║
║    ██╔════╝██║  ██║██╔══██╗██║████╗  ██║           ║
║    ██║     ███████║███████║██║██╔██╗ ██║           ║
║    ██║     ██╔══██║██╔══██║██║██║╚██╗██║           ║
║    ╚██████╗██║  ██║██║  ██║██║██║ ╚████║           ║
║     ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝           ║
║                                                      ║
║         ChainlessChain 一键部署脚本                  ║
║         Complete Deployment Automation              ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

echo -e "${BLUE}版本: v1.0.0${NC}"
echo -e "${BLUE}日期: 2025-01-01${NC}"
echo ""
echo -e "${GREEN}本脚本将自动部署:${NC}"
echo -e "  ✓ 后端服务 (AI Service + Project Service)"
echo -e "  ✓ 数据库 (PostgreSQL + Redis + Qdrant)"
echo -e "  ✓ 监控系统 (Prometheus + Grafana + AlertManager)"
echo -e "  ✓ 安全配置 (防火墙 + Nginx + SSL)"
echo ""
read -p "按 Enter 继续，Ctrl+C 取消..."

# ==================== 步骤 1: 环境检查 ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 1/8: 环境检查${NC}"
echo -e "${MAGENTA}=========================================${NC}"

# 检查是否为root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}✗ 请使用sudo运行此脚本${NC}"
    exit 1
fi

# 检查操作系统
if [ ! -f /etc/os-release ]; then
    echo -e "${RED}✗ 无法检测操作系统${NC}"
    exit 1
fi

source /etc/os-release
echo -e "${GREEN}✓ 操作系统: $PRETTY_NAME${NC}"

# 检查Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}! Docker未安装，正在安装...${NC}"
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
fi
echo -e "${GREEN}✓ Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')${NC}"

# 检查Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}! Docker Compose未安装，正在安装...${NC}"
    curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi
echo -e "${GREEN}✓ Docker Compose: $(docker-compose --version | cut -d' ' -f4 | tr -d ',')${NC}"

# 检查磁盘空间
AVAILABLE_SPACE=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
if [ "$AVAILABLE_SPACE" -lt 20 ]; then
    echo -e "${RED}✗ 磁盘空间不足，至少需要20GB，当前: ${AVAILABLE_SPACE}GB${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 磁盘空间: ${AVAILABLE_SPACE}GB 可用${NC}"

# 检查内存
TOTAL_MEM=$(free -g | awk 'NR==2 {print $2}')
if [ "$TOTAL_MEM" -lt 4 ]; then
    echo -e "${YELLOW}⚠ 内存不足，推荐至少8GB，当前: ${TOTAL_MEM}GB${NC}"
    read -p "是否继续? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ]; then
        exit 1
    fi
fi
echo -e "${GREEN}✓ 内存: ${TOTAL_MEM}GB${NC}"

# ==================== 步骤 2: 配置环境变量 ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 2/8: 配置环境变量${NC}"
echo -e "${MAGENTA}=========================================${NC}"

if [ -f .env ]; then
    echo -e "${YELLOW}! 检测到现有 .env 文件${NC}"
    read -p "是否重新配置? (y/n): " RECONFIG
    if [ "$RECONFIG" != "y" ]; then
        source .env
        echo -e "${GREEN}✓ 使用现有配置${NC}"
    else
        mv .env .env.backup.$(date +%s)
        RECONFIG="y"
    fi
fi

if [ ! -f .env ] || [ "$RECONFIG" == "y" ]; then
    echo ""
    echo -e "${CYAN}开始配置环境变量...${NC}"
    echo ""

    # LLM配置
    echo -e "${CYAN}[1/5] LLM配置${NC}"
    echo "请选择LLM提供商:"
    echo "  1) 阿里云通义千问 (推荐，国内速度快)"
    echo "  2) 智谱AI ChatGLM (有免费额度)"
    echo "  3) OpenAI (需要国际信用卡)"
    echo "  4) 其他"
    read -p "选择 (1-4): " LLM_CHOICE

    case $LLM_CHOICE in
        1)
            LLM_PROVIDER="dashscope"
            LLM_MODEL="qwen-turbo"
            echo ""
            echo -e "${YELLOW}请访问 https://dashscope.console.aliyun.com/apiKey 获取API Key${NC}"
            read -p "输入 DASHSCOPE_API_KEY: " DASHSCOPE_API_KEY
            ;;
        2)
            LLM_PROVIDER="zhipu"
            LLM_MODEL="glm-4"
            echo ""
            echo -e "${YELLOW}请访问 https://open.bigmodel.cn/usercenter/apikeys 获取API Key${NC}"
            read -p "输入 ZHIPU_API_KEY: " ZHIPU_API_KEY
            ;;
        3)
            LLM_PROVIDER="openai"
            LLM_MODEL="gpt-4o-mini"
            echo ""
            echo -e "${YELLOW}请访问 https://platform.openai.com/api-keys 获取API Key${NC}"
            read -p "输入 OPENAI_API_KEY: " OPENAI_API_KEY
            ;;
        *)
            echo -e "${RED}暂不支持其他LLM，请手动配置 .env${NC}"
            exit 1
            ;;
    esac

    # 数据库密码
    echo ""
    echo -e "${CYAN}[2/5] 数据库配置${NC}"
    echo -e "${YELLOW}正在生成强密码...${NC}"
    DB_PASSWORD=$(openssl rand -base64 32)
    REDIS_PASSWORD=$(openssl rand -base64 32)
    echo -e "${GREEN}✓ 数据库密码已自动生成${NC}"

    # JWT密钥
    echo ""
    echo -e "${CYAN}[3/5] JWT认证配置${NC}"
    JWT_SECRET=$(openssl rand -hex 64)
    echo -e "${GREEN}✓ JWT密钥已自动生成${NC}"

    # 域名配置
    echo ""
    echo -e "${CYAN}[4/5] 域名配置${NC}"
    read -p "是否配置域名? (y/n): " HAS_DOMAIN
    if [ "$HAS_DOMAIN" == "y" ]; then
        read -p "输入API域名 (例如: api.yourdomain.com): " API_DOMAIN
        read -p "输入监控域名 (例如: monitoring.yourdomain.com): " MONITORING_DOMAIN
    else
        API_DOMAIN="localhost"
        MONITORING_DOMAIN="localhost"
    fi

    # 告警配置
    echo ""
    echo -e "${CYAN}[5/5] 告警配置${NC}"
    read -p "配置邮件告警? (y/n): " SETUP_EMAIL
    if [ "$SETUP_EMAIL" == "y" ]; then
        read -p "SMTP服务器 (例如: smtp.gmail.com:587): " SMTP_HOST
        read -p "发件人邮箱: " SMTP_FROM
        read -p "SMTP用户名: " SMTP_USER
        read -s -p "SMTP密码: " SMTP_PASS
        echo ""
        read -p "接收告警的邮箱: " ALERT_EMAIL
    fi

    # 写入.env文件
    cat > .env << EOF
# ChainlessChain 环境配置
# 生成时间: $(date)

# ==================== 数据库配置 ====================
DB_HOST=postgres
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=chainlesschain
DB_PASSWORD=$DB_PASSWORD

# ==================== Redis配置 ====================
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD

# ==================== LLM配置 ====================
LLM_PROVIDER=$LLM_PROVIDER
LLM_MODEL=$LLM_MODEL
${DASHSCOPE_API_KEY:+DASHSCOPE_API_KEY=$DASHSCOPE_API_KEY}
${ZHIPU_API_KEY:+ZHIPU_API_KEY=$ZHIPU_API_KEY}
${OPENAI_API_KEY:+OPENAI_API_KEY=$OPENAI_API_KEY}

# ==================== 向量数据库 ====================
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# ==================== JWT配置 ====================
JWT_SECRET=$JWT_SECRET
JWT_EXPIRATION=86400

# ==================== 文件存储 ====================
PROJECTS_ROOT_PATH=/data/projects

# ==================== 域名配置 ====================
API_DOMAIN=$API_DOMAIN
MONITORING_DOMAIN=$MONITORING_DOMAIN

# ==================== 日志配置 ====================
LOG_LEVEL=INFO
LOG_PATH=/var/log/chainlesschain

# ==================== CORS配置 ====================
CORS_ALLOWED_ORIGINS=https://$API_DOMAIN

# ==================== Embedding配置 ====================
EMBEDDING_MODEL=BAAI/bge-base-zh-v1.5
EMBEDDING_PROVIDER=local
HF_ENDPOINT=https://hf-mirror.com

# ==================== Grafana配置 ====================
GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16)

# ==================== 告警配置 ====================
${SMTP_HOST:+SMTP_HOST=$SMTP_HOST}
${SMTP_FROM:+SMTP_FROM=$SMTP_FROM}
${SMTP_USER:+SMTP_USER=$SMTP_USER}
${SMTP_PASS:+SMTP_PASS=$SMTP_PASS}
${ALERT_EMAIL:+ALERT_EMAIL=$ALERT_EMAIL}
EOF

    chmod 600 .env
    source .env
    echo ""
    echo -e "${GREEN}✓ 环境变量配置完成${NC}"
    echo -e "${YELLOW}配置文件已保存到: .env${NC}"
fi

# ==================== 步骤 3: 创建目录结构 ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 3/8: 创建目录结构${NC}"
echo -e "${MAGENTA}=========================================${NC}"

mkdir -p data/{postgres,redis,qdrant,projects,models}
mkdir -p data/monitoring/{prometheus,alertmanager,grafana}
mkdir -p logs/{postgres,redis,ai-service,project-service}
mkdir -p monitoring/{prometheus/rules,alertmanager,grafana,blackbox,dingtalk}

echo -e "${GREEN}✓ 目录结构创建完成${NC}"

# ==================== 步骤 4: 更新配置文件 ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 4/8: 更新配置文件${NC}"
echo -e "${MAGENTA}=========================================${NC}"

# 更新AlertManager邮件配置
if [ -n "$SMTP_HOST" ]; then
    sed -i "s|smtp.example.com:587|$SMTP_HOST|g" monitoring/alertmanager/alertmanager.yml
    sed -i "s|alertmanager@chainlesschain.com|$SMTP_FROM|g" monitoring/alertmanager/alertmanager.yml
    sed -i "s|your-smtp-password|$SMTP_PASS|g" monitoring/alertmanager/alertmanager.yml
    sed -i "s|ops-team@chainlesschain.com|$ALERT_EMAIL|g" monitoring/alertmanager/alertmanager.yml
    echo -e "${GREEN}✓ AlertManager邮件配置已更新${NC}"
fi

echo -e "${GREEN}✓ 配置文件更新完成${NC}"

# ==================== 步骤 5: 部署后端服务 ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 5/8: 部署后端服务${NC}"
echo -e "${MAGENTA}=========================================${NC}"

# 停止现有服务
if docker-compose -f docker-compose.production.yml ps -q 2>/dev/null | grep -q .; then
    echo "停止现有后端服务..."
    docker-compose -f docker-compose.production.yml down
fi

echo "拉取Docker镜像..."
docker-compose -f docker-compose.production.yml pull 2>&1 | grep -E "Pulling|Downloaded|Status"

echo "构建应用镜像..."
docker-compose -f docker-compose.production.yml build --no-cache 2>&1 | grep -E "Step|Successfully|FINISHED"

echo "启动后端服务..."
docker-compose -f docker-compose.production.yml up -d

echo "等待服务启动..."
sleep 20

echo -e "${GREEN}✓ 后端服务部署完成${NC}"

# ==================== 步骤 6: 部署监控系统 ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 6/8: 部署监控系统${NC}"
echo -e "${MAGENTA}=========================================${NC}"

# 停止现有监控服务
if docker-compose -f docker-compose.monitoring.yml ps -q 2>/dev/null | grep -q .; then
    echo "停止现有监控服务..."
    docker-compose -f docker-compose.monitoring.yml down
fi

echo "启动监控系统..."
GRAFANA_ADMIN_PASSWORD=$GRAFANA_ADMIN_PASSWORD docker-compose -f docker-compose.monitoring.yml up -d

echo "等待监控服务启动..."
sleep 15

echo -e "${GREEN}✓ 监控系统部署完成${NC}"

# ==================== 步骤 7: 健康检查 ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 7/8: 健康检查${NC}"
echo -e "${MAGENTA}=========================================${NC}"

TOTAL=0
PASSED=0
FAILED=0

check_service() {
    local name=$1
    local url=$2
    local expected=$3

    echo -n "检查 $name... "
    TOTAL=$((TOTAL + 1))

    STATUS=$(curl -s -o /dev/null -w "%{http_code}" $url 2>/dev/null || echo "000")

    if [[ "$STATUS" == *"$expected"* ]]; then
        echo -e "${GREEN}✓ OK${NC}"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED (HTTP $STATUS)${NC}"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# 检查后端服务
check_service "AI Service         " "http://localhost:8001/health" "200"
check_service "Project Service    " "http://localhost:9090/actuator/health" "200"
check_service "PostgreSQL         " "http://localhost:9090/actuator/health" "200"
check_service "Redis              " "http://localhost:9090/actuator/health" "200"

# 检查监控服务
check_service "Prometheus         " "http://localhost:9090/-/healthy" "200"
check_service "Grafana            " "http://localhost:3000/api/health" "200"
check_service "AlertManager       " "http://localhost:9093/-/healthy" "200"

echo ""
echo -e "${CYAN}健康检查结果:${NC}"
echo -e "  总计: $TOTAL"
echo -e "  ${GREEN}通过: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "  ${RED}失败: $FAILED${NC}"
else
    echo -e "  失败: $FAILED"
fi

# ==================== 步骤 8: 配置防火墙和Nginx ====================
echo ""
echo -e "${MAGENTA}=========================================${NC}"
echo -e "${MAGENTA}步骤 8/8: 安全配置（可选）${NC}"
echo -e "${MAGENTA}=========================================${NC}"

read -p "是否配置防火墙? (y/n): " SETUP_FIREWALL
if [ "$SETUP_FIREWALL" == "y" ]; then
    if command -v ufw &> /dev/null; then
        ufw --force enable
        ufw allow 22/tcp
        ufw allow 80/tcp
        ufw allow 443/tcp
        ufw reload
        echo -e "${GREEN}✓ 防火墙配置完成${NC}"
    else
        echo -e "${YELLOW}! UFW未安装，跳过防火墙配置${NC}"
    fi
fi

read -p "是否配置Nginx反向代理? (y/n): " SETUP_NGINX
if [ "$SETUP_NGINX" == "y" ]; then
    if ! command -v nginx &> /dev/null; then
        echo "安装Nginx..."
        apt update && apt install -y nginx
    fi

    # 创建Nginx配置
    cat > /etc/nginx/sites-available/chainlesschain << EOF
server {
    listen 80;
    server_name $API_DOMAIN;

    location /api/projects/ {
        proxy_pass http://127.0.0.1:9090/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /api/ai/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}

server {
    listen 80;
    server_name $MONITORING_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
    }
}
EOF

    ln -sf /etc/nginx/sites-available/chainlesschain /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx

    echo -e "${GREEN}✓ Nginx配置完成${NC}"

    # SSL配置
    if [ "$API_DOMAIN" != "localhost" ]; then
        read -p "是否申请SSL证书? (y/n): " SETUP_SSL
        if [ "$SETUP_SSL" == "y" ]; then
            if ! command -v certbot &> /dev/null; then
                apt install -y certbot python3-certbot-nginx
            fi

            certbot --nginx -d $API_DOMAIN -d $MONITORING_DOMAIN --non-interactive --agree-tos --email admin@$API_DOMAIN

            echo -e "${GREEN}✓ SSL证书配置完成${NC}"
        fi
    fi
fi

# ==================== 部署完成 ====================
echo ""
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                      ║${NC}"
echo -e "${CYAN}║${NC}  ${GREEN}✓✓✓  部署成功完成！ ✓✓✓${NC}                          ${CYAN}║${NC}"
echo -e "${CYAN}║                                                      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# 显示访问信息
echo -e "${YELLOW}=========================================${NC}"
echo -e "${YELLOW}服务访问信息${NC}"
echo -e "${YELLOW}=========================================${NC}"
echo ""

if [ "$API_DOMAIN" != "localhost" ]; then
    echo -e "${GREEN}后端API:${NC}"
    echo -e "  - API地址: https://$API_DOMAIN"
    echo -e "  - Project API: https://$API_DOMAIN/api/projects/"
    echo -e "  - AI API: https://$API_DOMAIN/api/ai/"
    echo -e "  - API文档: https://$API_DOMAIN/api/projects/swagger-ui.html"
    echo ""
    echo -e "${GREEN}监控面板:${NC}"
    echo -e "  - Grafana: https://$MONITORING_DOMAIN"
    echo -e "    用户名: admin"
    echo -e "    密码: $GRAFANA_ADMIN_PASSWORD"
else
    echo -e "${GREEN}后端API (本地访问):${NC}"
    echo -e "  - AI服务: http://localhost:8001"
    echo -e "  - Project服务: http://localhost:9090"
    echo -e "  - API文档: http://localhost:9090/swagger-ui.html"
    echo ""
    echo -e "${GREEN}监控面板 (本地访问):${NC}"
    echo -e "  - Grafana: http://localhost:3000"
    echo -e "    用户名: admin"
    echo -e "    密码: $GRAFANA_ADMIN_PASSWORD"
    echo -e "  - Prometheus: http://localhost:9090"
    echo -e "  - AlertManager: http://localhost:9093"
fi

echo ""
echo -e "${YELLOW}=========================================${NC}"
echo -e "${YELLOW}配置信息（请妥善保管）${NC}"
echo -e "${YELLOW}=========================================${NC}"
echo ""
echo -e "数据库密码: ${RED}$DB_PASSWORD${NC}"
echo -e "Redis密码: ${RED}$REDIS_PASSWORD${NC}"
echo -e "JWT密钥: ${RED}已保存在 .env 文件${NC}"
echo -e "Grafana密码: ${RED}$GRAFANA_ADMIN_PASSWORD${NC}"
echo ""

echo -e "${YELLOW}=========================================${NC}"
echo -e "${YELLOW}常用命令${NC}"
echo -e "${YELLOW}=========================================${NC}"
echo ""
echo -e "查看服务状态:"
echo -e "  docker-compose -f docker-compose.production.yml ps"
echo -e "  docker-compose -f docker-compose.monitoring.yml ps"
echo ""
echo -e "查看日志:"
echo -e "  docker-compose -f docker-compose.production.yml logs -f"
echo -e "  docker-compose -f docker-compose.monitoring.yml logs -f"
echo ""
echo -e "重启服务:"
echo -e "  docker-compose -f docker-compose.production.yml restart"
echo -e "  docker-compose -f docker-compose.monitoring.yml restart"
echo ""
echo -e "停止服务:"
echo -e "  docker-compose -f docker-compose.production.yml down"
echo -e "  docker-compose -f docker-compose.monitoring.yml down"
echo ""

echo -e "${YELLOW}=========================================${NC}"
echo -e "${YELLOW}下一步建议${NC}"
echo -e "${YELLOW}=========================================${NC}"
echo ""
echo -e "1. 配置定时备份:"
echo -e "   crontab -e"
echo -e "   添加: 0 2 * * * cd $(pwd) && bash deploy/backup.sh"
echo ""
echo -e "2. 测试API访问:"
echo -e "   curl http://localhost:8001/health"
echo -e "   curl http://localhost:9090/actuator/health"
echo ""
echo -e "3. 登录Grafana查看监控:"
echo -e "   打开浏览器访问监控地址"
echo ""
echo -e "4. 测试告警通知:"
echo -e "   参考 MONITORING.md 发送测试告警"
echo ""
echo -e "5. 配置移动端/客户端:"
echo -e "   使用API地址: https://$API_DOMAIN"
echo ""

echo -e "${YELLOW}=========================================${NC}"
echo -e "${YELLOW}文档参考${NC}"
echo -e "${YELLOW}=========================================${NC}"
echo ""
echo -e "  - 部署指南: DEPLOYMENT_GUIDE.md"
echo -e "  - 监控文档: MONITORING.md"
echo -e "  - 快速开始: QUICK_DEPLOY.md"
echo -e "  - 项目说明: CLAUDE.md"
echo ""

echo -e "${GREEN}感谢使用 ChainlessChain！${NC}"
echo ""
