#!/bin/bash

# ChainlessChain 官网服务器部署脚�?v0.33.0

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "�?     ChainlessChain 官网服务器部署工�?v0.33.0         �?
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 配置变量（请根据实际情况修改�?SERVER_USER="root"
SERVER_HOST="your-server.com"
SERVER_PATH="/var/www/chainlesschain.com"
LOCAL_DIST="dist"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检�?dist 目录
if [ ! -d "$LOCAL_DIST" ]; then
    echo -e "${RED}�?dist 目录不存在，请先运行构建脚本${NC}"
    echo ""
    echo "运行命令: node build.js"
    echo ""
    exit 1
fi

# 显示配置
echo -e "${BLUE}📋 部署配置:${NC}"
echo "   - 服务�? $SERVER_USER@$SERVER_HOST"
echo "   - 目标路径: $SERVER_PATH"
echo "   - 本地目录: $LOCAL_DIST"
echo ""

echo -e "${YELLOW}⚠️  请先修改此脚本中的服务器配置信息�?{NC}"
echo ""
echo "需要修改的变量:"
echo "   - SERVER_USER (服务器用户名)"
echo "   - SERVER_HOST (服务器地址)"
echo "   - SERVER_PATH (服务器目标路�?"
echo ""

read -p "配置已修改，确认部署? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}�?已取消部�?{NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}🚀 开始部�?..${NC}"
echo ""

# 检�?rsync 是否存在
if command -v rsync &> /dev/null; then
    echo -e "${GREEN}�?使用 Rsync 同步文件...${NC}"

    rsync -avz --delete \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='*.md' \
        --exclude='*.txt' \
        --exclude='build.js' \
        "$LOCAL_DIST/" "$SERVER_USER@$SERVER_HOST:$SERVER_PATH/"

    DEPLOY_RESULT=$?
elif command -v scp &> /dev/null; then
    echo -e "${GREEN}�?使用 SCP 上传文件...${NC}"

    scp -r "$LOCAL_DIST"/* "$SERVER_USER@$SERVER_HOST:$SERVER_PATH/"

    DEPLOY_RESULT=$?
else
    echo -e "${RED}�?未找�?rsync �?scp 工具${NC}"
    echo ""
    echo "请安�?rsync: "
    echo "   Ubuntu/Debian: sudo apt-get install rsync"
    echo "   CentOS/RHEL: sudo yum install rsync"
    echo "   macOS: brew install rsync"
    echo ""
    exit 1
fi

# 检查结�?if [ $DEPLOY_RESULT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}�?部署成功�?{NC}"
    echo ""
    echo -e "${BLUE}📝 后续操作:${NC}"
    echo "   1. SSH 登录服务器检查文�?
    echo "   2. 配置 Nginx/Apache（如果还未配置）"
    echo "   3. 重启 Web 服务器（如需要）"
    echo "   4. 访问网站测试"
    echo ""

    read -p "是否查看 Nginx 配置示例? (y/N) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cat << 'EOF'

╔════════════════════════════════════════════════════════════╗
�?             Nginx 配置示例                               �?╚════════════════════════════════════════════════════════════╝

server {
    listen 80;
    listen [::]:80;
    server_name www.chainlesschain.com chainlesschain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.chainlesschain.com chainlesschain.com;

    # SSL 证书（使�?Let's Encrypt�?    ssl_certificate /etc/letsencrypt/live/chainlesschain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chainlesschain.com/privkey.pem;

    # 网站根目�?    root /var/www/chainlesschain.com;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 静态文件缓�?    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 主页
    location / {
        try_files $uri $uri/ /index.html;
    }
}

保存�? /etc/nginx/sites-available/chainlesschain.com
启用: sudo ln -s /etc/nginx/sites-available/chainlesschain.com /etc/nginx/sites-enabled/
重启: sudo systemctl restart nginx

EOF
    fi
else
    echo ""
    echo -e "${RED}�?部署失败�?{NC}"
    echo ""
    echo "可能的原�?"
    echo "   1. SSH 连接失败"
    echo "   2. 权限不足"
    echo "   3. 目标路径不存�?
    echo ""
    echo "调试建议:"
    echo "   1. 测试 SSH 连接: ssh $SERVER_USER@$SERVER_HOST"
    echo "   2. 检查目标路�? ssh $SERVER_USER@$SERVER_HOST 'ls -la $SERVER_PATH'"
    echo "   3. 检查权�? ssh $SERVER_USER@$SERVER_HOST 'ls -ld $SERVER_PATH'"
    echo ""
fi

exit $DEPLOY_RESULT
