#!/bin/bash
# Deploy 3 chainlesschain sites to 47.111.5.128
# Prompts for root password 3 times (or once if SSH key is authorized).

set -e

SERVER="root@47.111.5.128"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 1/3  官网 v2  → www.chainlesschain.com"
rsync -avz --delete \
  "$ROOT/docs-website-v2/dist/" \
  "$SERVER:/www/wwwroot/www.chainlesschain.com/"

echo "==> 2/3  用户文档 → docs.chainlesschain.com"
rsync -avz --delete \
  "$ROOT/docs-site/docs/.vitepress/dist/" \
  "$SERVER:/www/wwwroot/docs.chainlesschain.com/"

echo "==> 3/3  设计文档 → design.chainlesschain.com"
rsync -avz --delete \
  "$ROOT/docs-site-design/docs/.vitepress/dist/" \
  "$SERVER:/www/wwwroot/design.chainlesschain.com/"

echo "✅ All 3 sites deployed."
