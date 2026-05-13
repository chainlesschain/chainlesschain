#!/bin/bash
# 部署 cc-signaling-relay 到 VPS。SSH 上去后跑此脚本。
# 前置: docker + docker-compose + nginx + 已有 BT panel 证书目录约定

set -euo pipefail

DOMAIN="signaling.chainlesschain.com"
RELAY_DIR="/opt/cc-signaling-relay"
NGINX_VHOST_DIR="/www/server/panel/vhost/nginx"
NGINX_VHOST="${NGINX_VHOST_DIR}/${DOMAIN}.conf"
CERT_DIR="/www/server/panel/vhost/cert/${DOMAIN}"
WEBROOT="/www/wwwroot/${DOMAIN}"

echo "==> 1) 落地 relay docker 工程到 ${RELAY_DIR}"
mkdir -p "${RELAY_DIR}/server"

echo "==> 2) 准备 cert webroot + acme-challenge 目录"
mkdir -p "${WEBROOT}/.well-known/acme-challenge"
chown -R nginx:nginx "${WEBROOT}" 2>/dev/null || true

echo "==> 3) 启 docker compose"
cd "${RELAY_DIR}"
docker compose up -d --build

echo "==> 4) 等容器健康"
sleep 3
curl -fsS http://127.0.0.1:9001/health || (echo "relay health failed"; docker compose logs --tail=50; exit 1)
echo "relay healthy"

echo "==> 5) 检查证书是否已存在"
if [ -f "${CERT_DIR}/fullchain.pem" ]; then
    echo "cert exists at ${CERT_DIR}, skip issuing"
else
    echo "cert missing — 你需要在 BT 面板上申请 SSL，或者用 acme.sh:"
    echo "  /root/.acme.sh/acme.sh --issue -d ${DOMAIN} -w ${WEBROOT}"
    echo "  /root/.acme.sh/acme.sh --install-cert -d ${DOMAIN} \\"
    echo "    --key-file       ${CERT_DIR}/privkey.pem \\"
    echo "    --fullchain-file ${CERT_DIR}/fullchain.pem \\"
    echo "    --reloadcmd     'nginx -s reload'"
    echo ""
    echo "如果 acme.sh 没装，先装："
    echo "  curl https://get.acme.sh | sh -s email=you@example.com"
fi

echo "==> 6) 部署 nginx vhost"
cp "${RELAY_DIR}/nginx-signaling.conf" "${NGINX_VHOST}"
nginx -t && nginx -s reload
echo "nginx reloaded"

echo "==> Done. 测试: curl -i https://${DOMAIN}/health"
