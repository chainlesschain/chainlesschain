#!/bin/bash

##############################################
# ChainlessChain 监控系统一键部署脚本
# 用途: 自动部署Prometheus + Grafana + AlertManager
# 使用: sudo ./setup-monitoring.sh
##############################################

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════╗
║   ChainlessChain 监控系统部署        ║
║   Prometheus + Grafana + AlertManager║
╚═══════════════════════════════════════╝
EOF
echo -e "${NC}"

# 检查是否在正确的目录
if [ ! -f "docker-compose.monitoring.yml" ]; then
    echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
    exit 1
fi

echo ""
echo "========================================="
echo "步骤 1/7: 环境检查"
echo "========================================="

# 检查Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker已安装${NC}"

# 检查Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose已安装${NC}"

# 加载环境变量
if [ -f .env ]; then
    source .env
    echo -e "${GREEN}✓ 环境变量已加载${NC}"
else
    echo -e "${YELLOW}⚠ .env文件不存在，使用默认配置${NC}"
fi

echo ""
echo "========================================="
echo "步骤 2/7: 创建监控数据目录"
echo "========================================="

mkdir -p monitoring/{prometheus/{rules},alertmanager,grafana/{provisioning/{datasources,dashboards},dashboards},blackbox,dingtalk}
mkdir -p data/monitoring/{prometheus,alertmanager,grafana}

echo -e "${GREEN}✓ 目录创建完成${NC}"

echo ""
echo "========================================="
echo "步骤 3/7: 配置告警通知"
echo "========================================="

# 询问是否配置邮件通知
read -p "是否配置邮件通知? (y/n): " SETUP_EMAIL

if [ "$SETUP_EMAIL" == "y" ]; then
    read -p "SMTP服务器地址 (例如: smtp.gmail.com:587): " SMTP_HOST
    read -p "发件人邮箱: " SMTP_FROM
    read -p "SMTP用户名: " SMTP_USER
    read -s -p "SMTP密码: " SMTP_PASS
    echo ""
    read -p "接收告警的邮箱: " ALERT_EMAIL

    # 更新AlertManager配置
    sed -i "s|smtp.example.com:587|$SMTP_HOST|g" monitoring/alertmanager/alertmanager.yml
    sed -i "s|alertmanager@chainlesschain.com|$SMTP_FROM|g" monitoring/alertmanager/alertmanager.yml
    sed -i "s|your-smtp-password|$SMTP_PASS|g" monitoring/alertmanager/alertmanager.yml
    sed -i "s|ops-team@chainlesschain.com|$ALERT_EMAIL|g" monitoring/alertmanager/alertmanager.yml

    echo -e "${GREEN}✓ 邮件通知已配置${NC}"
else
    echo -e "${YELLOW}⚠ 跳过邮件通知配置${NC}"
fi

# 询问是否配置钉钉通知
read -p "是否配置钉钉通知? (y/n): " SETUP_DINGTALK

if [ "$SETUP_DINGTALK" == "y" ]; then
    read -p "钉钉Webhook URL: " DINGTALK_URL

    # 更新钉钉配置
    sed -i "s|https://oapi.dingtalk.com/robot/send?access_token=YOUR_DINGTALK_ACCESS_TOKEN|$DINGTALK_URL|g" monitoring/dingtalk/config.yml

    echo -e "${GREEN}✓ 钉钉通知已配置${NC}"
else
    echo -e "${YELLOW}⚠ 跳过钉钉通知配置${NC}"
fi

echo ""
echo "========================================="
echo "步骤 4/7: 配置Grafana"
echo "========================================="

# 设置Grafana管理员密码
read -s -p "设置Grafana管理员密码（默认: admin123）: " GRAFANA_PASSWORD
echo ""
GRAFANA_PASSWORD=${GRAFANA_PASSWORD:-admin123}

# 导出环境变量
export GRAFANA_ADMIN_PASSWORD=$GRAFANA_PASSWORD

echo -e "${GREEN}✓ Grafana密码已设置${NC}"

echo ""
echo "========================================="
echo "步骤 5/7: 启动监控服务"
echo "========================================="

# 停止现有监控服务
if docker-compose -f docker-compose.monitoring.yml ps -q 2>/dev/null | grep -q .; then
    echo "停止现有监控服务..."
    docker-compose -f docker-compose.monitoring.yml down
fi

# 启动监控服务
echo "启动监控栈..."
GRAFANA_ADMIN_PASSWORD=$GRAFANA_PASSWORD docker-compose -f docker-compose.monitoring.yml up -d

echo ""
echo "等待服务启动..."
sleep 15

# 检查服务状态
docker-compose -f docker-compose.monitoring.yml ps

echo ""
echo "========================================="
echo "步骤 6/7: 验证监控服务"
echo "========================================="

# 检查Prometheus
echo -n "检查Prometheus... "
PROM_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:9090/-/healthy 2>/dev/null || echo "000")
if [ "$PROM_STATUS" == "200" ]; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# 检查Grafana
echo -n "检查Grafana... "
GRAFANA_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
if [ "$GRAFANA_STATUS" == "200" ]; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# 检查AlertManager
echo -n "检查AlertManager... "
AM_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:9093/-/healthy 2>/dev/null || echo "000")
if [ "$AM_STATUS" == "200" ]; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ FAILED${NC}"
fi

echo ""
echo "========================================="
echo "步骤 7/7: 配置Nginx反向代理（可选）"
echo "========================================="

read -p "是否配置Nginx反向代理? (y/n): " SETUP_NGINX

if [ "$SETUP_NGINX" == "y" ]; then
    if ! command -v nginx &> /dev/null; then
        echo "安装Nginx..."
        apt update
        apt install -y nginx
    fi

    # 创建Nginx配置
    cat > /etc/nginx/sites-available/monitoring << 'EOF'
server {
    listen 80;
    server_name monitoring.yourdomain.com;

    # Grafana
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Prometheus
    location /prometheus/ {
        proxy_pass http://127.0.0.1:9090/;
        proxy_set_header Host $host;
    }

    # AlertManager
    location /alertmanager/ {
        proxy_pass http://127.0.0.1:9093/;
        proxy_set_header Host $host;
    }
}
EOF

    # 启用配置
    ln -sf /etc/nginx/sites-available/monitoring /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx

    echo -e "${GREEN}✓ Nginx配置完成${NC}"
    echo -e "${YELLOW}⚠ 请修改配置中的域名: /etc/nginx/sites-available/monitoring${NC}"
else
    echo -e "${YELLOW}⚠ 跳过Nginx配置${NC}"
fi

echo ""
echo "========================================="
echo -e "${GREEN}监控系统部署完成！${NC}"
echo "========================================="
echo ""
echo "访问地址:"
echo "  - Grafana:      http://localhost:3000"
echo "    用户名: admin"
echo "    密码: $GRAFANA_PASSWORD"
echo ""
echo "  - Prometheus:   http://localhost:9090"
echo "  - AlertManager: http://localhost:9093"
echo ""
echo "查看日志:"
echo "  docker-compose -f docker-compose.monitoring.yml logs -f"
echo ""
echo "停止监控:"
echo "  docker-compose -f docker-compose.monitoring.yml down"
echo ""
echo "下一步:"
echo "  1. 登录Grafana导入仪表盘"
echo "  2. 测试告警通知"
echo "  3. 自定义告警规则"
echo ""
echo "详细文档: MONITORING.md"
echo "========================================="
