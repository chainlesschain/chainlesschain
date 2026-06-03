#!/usr/bin/env bash
# Fix BT Panel nginx config for plugins.chainlesschain.com:
#   1) Write reverse-proxy include to forward / -> 127.0.0.1:8090 (Spring)
#   2) Repair wrong-root in any prior .well-known block (so LE ACME validation works)
#   3) Validate nginx config, reload, and self-test [A] Spring [B] proxy [C] ACME path
#
# Usage:  sudo bash fix-bt-nginx-marketplace.sh
# Safe to re-run (idempotent). Auto-rolls-back on nginx config error.

set -eu

DOMAIN="plugins.chainlesschain.com"
UPSTREAM="http://127.0.0.1:8090"
CONF="/www/server/panel/vhost/nginx/${DOMAIN}.conf"
PROXY_DIR="/www/server/panel/vhost/nginx/proxy/${DOMAIN}"
PROXY_FILE="${PROXY_DIR}/plugin-marketplace.conf"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
blue()   { printf "\033[34m%s\033[0m\n" "$*"; }

# ── Sanity ────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || { red "❌ 必须 root 跑（前面加 sudo）"; exit 1; }
[ -f "$CONF" ] || { red "❌ 找不到 $CONF —— 宝塔站点没建？"; exit 1; }

# ── Detect actual server-level root ──────────────────────
ACTUAL_ROOT=$(awk '/^[[:space:]]*root[[:space:]]/{gsub(/^[[:space:]]*root[[:space:]]+|;[[:space:]]*$/,""); print; exit}' "$CONF")
if [ -z "$ACTUAL_ROOT" ]; then
    red "❌ 主 conf 里没找到 root 指令"; exit 1
fi
blue "==> 站点 docroot: $ACTUAL_ROOT"
DOCROOT="$ACTUAL_ROOT"

# ── Backup ─────────────────────────────────────────────────
TS=$(date +%s)
cp "$CONF" "${CONF}.fix-bak.${TS}"
green "✓ 备份 ${CONF}.fix-bak.${TS}"

# ── 1. Repair wrong-root block (e.g. /www/wwwroot/... when actual is /data/www/...) ──
WRONG_ROOTS="/www/wwwroot/${DOMAIN}"
if grep -qF "$WRONG_ROOTS" "$CONF" && [ "$DOCROOT" != "$WRONG_ROOTS" ]; then
    sed -i "s|root ${WRONG_ROOTS};|root ${DOCROOT};|g" "$CONF"
    green "✓ 修正错误的 root 路径 (${WRONG_ROOTS} -> ${DOCROOT})"
else
    yellow "ℹ️  无需修正 root 路径"
fi

# ── 2. Write proxy include file ───────────────────────────
mkdir -p "$PROXY_DIR"
cat > "$PROXY_FILE" <<NGINX
location ^~ /
{
    proxy_pass ${UPSTREAM};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
NGINX
green "✓ 写入反代 $PROXY_FILE"

# ── 3. Validate + reload (auto-rollback on failure) ──────
if nginx -t 2>&1; then
    nginx -s reload
    green "✓ nginx 已 reload"
else
    red "❌ nginx 配置测试失败，回滚"
    cp "${CONF}.fix-bak.${TS}" "$CONF"
    rm -f "$PROXY_FILE"
    nginx -s reload
    exit 1
fi

# ── 4. Self-tests ──────────────────────────────────────────
echo ""
blue "=========================================="
blue "  验证三段"
blue "=========================================="

PASS_A=0; PASS_B=0; PASS_C=0

echo ""
blue "[A] Spring 直连 ($UPSTREAM/api/actuator/health)"
if RESP=$(curl -fsS --max-time 5 "${UPSTREAM}/api/actuator/health" 2>&1); then
    green "  ✓ $RESP"
    PASS_A=1
else
    red "  ❌ Spring 没响应：$RESP"
    yellow "  → docker ps | grep marketplace；没容器跑 docker compose up -d plugin-marketplace-service"
fi

echo ""
blue "[B] nginx 反代到 Spring（HTTP via Host 头）"
if RESP=$(curl -fsS --max-time 5 -H "Host: ${DOMAIN}" http://127.0.0.1/api/actuator/health 2>&1); then
    green "  ✓ $RESP"
    PASS_B=1
else
    red "  ❌ 反代失败：$RESP"
fi

echo ""
blue "[C] .well-known 静态文件（LE ACME 验证路径）"
mkdir -p "${DOCROOT}/.well-known/acme-challenge"
TOKEN_VALUE="bt-fix-test-${TS}"
echo "$TOKEN_VALUE" > "${DOCROOT}/.well-known/acme-challenge/test-token"
chmod -R 755 "${DOCROOT}/.well-known"
chmod 644 "${DOCROOT}/.well-known/acme-challenge/test-token"
if RESP=$(curl -fsS --max-time 5 "http://${DOMAIN}/.well-known/acme-challenge/test-token" 2>&1) && [ "$RESP" = "$TOKEN_VALUE" ]; then
    green "  ✓ $RESP"
    PASS_C=1
else
    red "  ❌ 返回: $RESP（期望: $TOKEN_VALUE）"
    yellow "  → 检查 ${CONF} 里 .well-known location 块的 root 是否 = ${DOCROOT}"
fi
rm -f "${DOCROOT}/.well-known/acme-challenge/test-token"

# ── Summary ────────────────────────────────────────────────
echo ""
blue "=========================================="
TOTAL=$((PASS_A + PASS_B + PASS_C))
if [ "$TOTAL" -eq 3 ]; then
    green "  全绿（3/3）— 可以去 BT 申请 SSL"
    yellow "  注意：LE 限流到北京时间 11:44 才解锁，过点再点 申请"
else
    red "  $TOTAL/3 通过 — 还有问题，看上面红字"
fi
blue "=========================================="
