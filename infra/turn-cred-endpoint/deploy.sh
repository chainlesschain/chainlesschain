#!/usr/bin/env bash
# FAMILY-67 plan B — deploy TURN-credential endpoint to 47.111.5.128.
# 在服务器上跑（已 scp turn_cred_server.py 到 /opt/cc-turn-cred/）。幂等。
#
# 前置：Alibaba 安全组已放行 UDP 3478 + UDP 49152-65535（否则 TURN 仍不 relay）。
set -euo pipefail

APP_DIR=/opt/cc-turn-cred
NGINX_CONF=/www/server/panel/vhost/nginx/signaling.chainlesschain.com.conf

mkdir -p "$APP_DIR"
# turn_cred_server.py 应已在 $APP_DIR（scp 上来）

# 从 coturn 配置读 static-auth-secret，避免到处复制 secret。
SECRET=$(grep -E '^static-auth-secret=' /opt/cc-turn/turnserver.conf | cut -d= -f2-)
if [ -z "${SECRET}" ]; then echo "ERROR: static-auth-secret not found in /opt/cc-turn/turnserver.conf" >&2; exit 1; fi

# systemd unit（secret 经 Environment 注入，不落盘到 world-readable）
cat > /etc/systemd/system/cc-turn-cred.service <<UNIT
[Unit]
Description=ChainlessChain TURN credential endpoint (FAMILY-67 plan B)
After=network.target

[Service]
Type=simple
Environment=CC_TURN_SECRET=${SECRET}
Environment=CC_TURN_HOST=turn.chainlesschain.com
Environment=CC_TURN_TTL=86400
Environment=CC_TURN_PORT=9002
ExecStart=/usr/bin/python3 ${APP_DIR}/turn_cred_server.py
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

chmod 600 /etc/systemd/system/cc-turn-cred.service  # secret 在内，限读
systemctl daemon-reload
systemctl enable --now cc-turn-cred
sleep 1
echo "=== local healthz ==="; curl -sS http://127.0.0.1:9002/healthz; echo
echo "=== local sign sample ==="; curl -sS "http://127.0.0.1:9002/turn-credentials?uid=probe"; echo

# nginx：在 signaling server_block 里加 location（若尚未加）。手动确认更安全 —
# 这里只打印建议片段，不自动改 nginx 防破坏既有 WS 反代。
cat <<'NGINX'

>>> 手动在 signaling.chainlesschain.com.conf 的 server{} 内加（在 WS location 之外）：

    location = /turn-credentials {
        proxy_pass http://127.0.0.1:9002;
        proxy_set_header Host $host;
    }

加完跑：nginx -t && nginx -s reload
然后外网验证：curl https://signaling.chainlesschain.com/turn-credentials?uid=probe
NGINX
