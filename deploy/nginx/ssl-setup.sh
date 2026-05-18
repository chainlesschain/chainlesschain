#!/bin/bash

##############################################
# ChainlessChain SSL证书自动配置脚本
# 用途: 使用Let's Encrypt自动申请和配置SSL证书
# 使用: sudo ./ssl-setup.sh yourdomain.com
##############################################

set -e

if [ -z "$1" ]; then
    echo "使用方法: $0 <domain>"
    echo "示例: $0 api.yourdomain.com"
    exit 1
fi

DOMAIN=$1
EMAIL=${2:-admin@$DOMAIN}

echo "========================================="
echo "ChainlessChain SSL证书配置"
echo "========================================="
echo "域名: $DOMAIN"
echo "邮箱: $EMAIL"
echo ""

# 检查是否为root
if [ "$EUID" -ne 0 ]; then
    echo "错误: 请使用sudo运行此脚本"
    exit 1
fi

# 检查Nginx
if ! command -v nginx &> /dev/null; then
    echo "安装Nginx..."
    apt update
    apt install -y nginx
fi

# 检查Certbot
if ! command -v certbot &> /dev/null; then
    echo "安装Certbot..."
    apt update
    apt install -y certbot python3-certbot-nginx
fi

# 创建临时Nginx配置（仅HTTP，用于域名验证）
echo "创建临时Nginx配置..."
cat > /etc/nginx/sites-available/chainlesschain-temp << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'ChainlessChain API Server';
        add_header Content-Type text/plain;
    }
}
EOF

# 创建certbot webroot目录
mkdir -p /var/www/certbot

# 启用临时配置
ln -sf /etc/nginx/sites-available/chainlesschain-temp /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试Nginx配置
nginx -t

# 重载Nginx
systemctl reload nginx

# 申请证书
echo ""
echo "申请SSL证书..."
certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    -d $DOMAIN \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --keep-until-expiring

# 检查证书是否成功
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo "错误: 证书申请失败"
    exit 1
fi

echo ""
echo "✓ SSL证书申请成功"

# 替换Nginx配置中的域名
echo ""
echo "配置Nginx反向代理..."
cp ./chainlesschain.conf /etc/nginx/sites-available/chainlesschain
sed -i "s/api.yourdomain.com/$DOMAIN/g" /etc/nginx/sites-available/chainlesschain

# 启用正式配置
ln -sf /etc/nginx/sites-available/chainlesschain /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/chainlesschain-temp

# 测试配置
nginx -t

# 重载Nginx
systemctl reload nginx

# 配置自动续期
echo ""
echo "配置SSL证书自动续期..."
systemctl enable certbot.timer
systemctl start certbot.timer

# 测试续期（dry-run）
certbot renew --dry-run

echo ""
echo "========================================="
echo "SSL证书配置完成"
echo "========================================="
echo ""
echo "证书位置: /etc/letsencrypt/live/$DOMAIN/"
echo "自动续期: 已启用（每天检查两次）"
echo ""
echo "访问地址: https://$DOMAIN"
echo ""
echo "验证SSL配置:"
echo "  curl https://$DOMAIN/health"
echo ""
echo "查看证书信息:"
echo "  certbot certificates"
echo ""
echo "手动续期:"
echo "  certbot renew"
echo ""
echo "========================================="
