#!/usr/bin/env bash
###############################################################################
# ChainlessChain — 文档站可复用部署脚本 (deploy-docs)
#
# 构建并把三个静态站点发布到服务器 web root：
#   docs   → docs.chainlesschain.com   (VitePress, docs-site/)
#   design → design.chainlesschain.com (VitePress, docs-site-design/)
#   www    → www.chainlesschain.com    (Astro,     docs-website-v2/)
#
# 特性：
#   - 截断渲染守卫：构建后断言 HTML 页数 ≥ 阈值（VitePress 子超时会 exit 0 但产 0 HTML，
#     见 .github/workflows/docs-site-build-gate.yml / memory vitepress-build-timeout-thresholds）
#   - 服务器端时间戳备份（bak-<site>-YYYYmmdd-HHMMSS），自动保留最近 N 份
#   - rsync --delete 增量发布；--dry-run 只预览不改服务器
#   - 不硬编码任何 host/密钥：连接信息全部来自 deploy/docs-deploy.config.sh（gitignored）
#
# 用法：
#   deploy/deploy-docs.sh <docs|design|www|all> [选项]
#
# 选项：
#   --dry-run       rsync -n，仅预览将同步的文件，不备份、不改服务器
#   --no-build      跳过构建，直接用现有 dist（须先构建过）
#   --no-backup     跳过服务器端备份（不推荐）
#   --yes, -y       跳过发布前确认提示（用于 CI / 无人值守）
#   --help, -h      显示本帮助
#
# 首次使用：
#   cp deploy/docs-deploy.config.sh.example deploy/docs-deploy.config.sh
#   # 编辑填入 DEPLOY_SSH_HOST / DEPLOY_WEBROOT_* 等
#   deploy/deploy-docs.sh docs --dry-run     # 先预览
#   deploy/deploy-docs.sh docs               # 正式发布
###############################################################################

set -euo pipefail

# ---------- 定位仓库根 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---------- 颜色 ----------
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
  BLUE=$'\033[0;34m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'
else
  RED=; GREEN=; YELLOW=; BLUE=; CYAN=; NC=
fi
info()  { echo -e "${BLUE}[deploy-docs]${NC} $*"; }
ok()    { echo -e "${GREEN}[deploy-docs] ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy-docs] !${NC} $*"; }
die()   { echo -e "${RED}[deploy-docs] ✗ $*${NC}" >&2; exit 1; }

# ---------- 站点元数据 ----------
# site | 项目目录 | 构建产物目录（相对 REPO_ROOT） | 默认最小 HTML 数
site_projdir() { case "$1" in
  docs)   echo "docs-site" ;;
  design) echo "docs-site-design" ;;
  www)    echo "docs-website-v2" ;;
  *) return 1 ;; esac; }
site_distdir() { case "$1" in
  docs)   echo "docs-site/docs/.vitepress/dist" ;;
  design) echo "docs-site-design/docs/.vitepress/dist" ;;
  www)    echo "docs-website-v2/dist" ;;
  *) return 1 ;; esac; }
site_default_min_html() { case "$1" in
  docs)   echo "400" ;;   # 实测 ~487 页（gate 阈值同）
  design) echo "40" ;;
  www)    echo "3" ;;
  *) echo "1" ;; esac; }
site_domain() { case "$1" in
  docs)   echo "docs.chainlesschain.com" ;;
  design) echo "design.chainlesschain.com" ;;
  www)    echo "www.chainlesschain.com" ;;
  *) echo "?" ;; esac; }

# ---------- 解析参数 ----------
TARGET=""
DRY_RUN=0; DO_BUILD=1; DO_BACKUP=1; ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    docs|design|www|all) TARGET="$arg" ;;
    --dry-run)   DRY_RUN=1 ;;
    --no-build)  DO_BUILD=0 ;;
    --no-backup) DO_BACKUP=0 ;;
    --yes|-y)    ASSUME_YES=1 ;;
    --help|-h)   sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数: $arg（用 --help 看用法）" ;;
  esac
done
[ -n "$TARGET" ] || die "请指定要发布的站点: docs | design | www | all（用 --help 看用法）"

# ---------- 加载配置 ----------
CONFIG="$SCRIPT_DIR/docs-deploy.config.sh"
if [ ! -f "$CONFIG" ]; then
  die "缺少配置文件 $CONFIG
  先执行: cp deploy/docs-deploy.config.sh.example deploy/docs-deploy.config.sh
  然后填入 DEPLOY_SSH_HOST / DEPLOY_WEBROOT_* 等（该文件已被 .gitignore 忽略，不会入库）"
fi
# shellcheck disable=SC1090
source "$CONFIG"

: "${DEPLOY_SSH_USER:?配置缺少 DEPLOY_SSH_USER}"
: "${DEPLOY_SSH_PORT:=22}"
: "${DEPLOY_KEEP_BACKUPS:=5}"

# ---------- 依赖检查 ----------
command -v rsync >/dev/null 2>&1 || die "未找到 rsync（Windows 可用 Git-Bash + rsync 包，或在 Linux/WSL 上运行）"
command -v ssh   >/dev/null 2>&1 || die "未找到 ssh"

# 每站可覆盖 host；否则用全局 DEPLOY_SSH_HOST
resolve_host()    { local v="DEPLOY_SSH_HOST_$1";    echo "${!v:-${DEPLOY_SSH_HOST:-}}"; }
resolve_webroot() { local v="DEPLOY_WEBROOT_$1";     echo "${!v:-}"; }
resolve_min_html(){ local v="MIN_HTML_$1";           echo "${!v:-$(site_default_min_html "$1")}"; }

SSH_OPTS=(-p "$DEPLOY_SSH_PORT")
[ -n "${DEPLOY_SSH_KEY:-}" ] && SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

# ---------- 单站部署 ----------
deploy_site() {
  local site="$1"
  local projdir distdir host webroot min_html
  projdir="$(site_projdir "$site")"
  distdir="$(site_distdir "$site")"
  host="$(resolve_host "$site")"
  webroot="$(resolve_webroot "$site")"
  min_html="$(resolve_min_html "$site")"

  echo ""
  echo -e "${CYAN}=====================================================${NC}"
  echo -e "${CYAN} 发布 [$site] → $(site_domain "$site")${NC}"
  echo -e "${CYAN}=====================================================${NC}"

  [ -n "$host" ]    || die "[$site] 配置缺少服务器地址（DEPLOY_SSH_HOST 或 DEPLOY_SSH_HOST_$site）"
  [ -n "$webroot" ] || die "[$site] 配置缺少 web root（DEPLOY_WEBROOT_$site）"

  # 1) 构建
  if [ "$DO_BUILD" -eq 1 ]; then
    info "[$site] 构建中（$projdir）…"
    ( cd "$projdir"
      if [ ! -d node_modules ]; then
        info "[$site] 首次安装依赖 npm ci…"
        npm ci
      fi
      npm run build )
    ok "[$site] 构建完成"
  else
    warn "[$site] 跳过构建（--no-build），使用现有 dist"
  fi

  # 2) 截断渲染守卫
  [ -d "$distdir" ] || die "[$site] 产物目录不存在: $distdir（是否漏了构建？）"
  local html_count
  html_count="$(find "$distdir" -name '*.html' | wc -l | tr -d ' ')"
  info "[$site] 渲染出 $html_count 个 HTML 页（阈值 $min_html）"
  if [ "$html_count" -lt "$min_html" ]; then
    die "[$site] 只有 $html_count 个 HTML 页（< $min_html）— 疑似截断渲染，拒绝发布。
    见 memory vitepress-build-timeout-thresholds：子超时构建会 exit 0 但产 0 HTML。"
  fi

  local remote="${DEPLOY_SSH_USER}@${host}"

  # 3) dry-run：只预览，不动服务器
  if [ "$DRY_RUN" -eq 1 ]; then
    warn "[$site] DRY-RUN：以下为 rsync 将同步的变更（不备份、不实际写入）"
    rsync -az --delete -n --itemize-changes -e "$RSYNC_SSH" \
      "$distdir"/ "${remote}:${webroot}/"
    ok "[$site] DRY-RUN 完成（服务器未改动）"
    return 0
  fi

  # 4) 发布前确认
  if [ "$ASSUME_YES" -ne 1 ]; then
    echo ""
    echo -e "${YELLOW}即将发布:${NC}"
    echo -e "  本地产物 : $distdir  ($html_count HTML)"
    echo -e "  目标     : ${remote}:${webroot}/"
    echo -e "  ${RED}rsync --delete 会删除服务器上多余文件（发布前会先备份）${NC}"
    read -r -p "确认发布 [$site]? (yes/no) " confirm
    [ "$confirm" = "yes" ] || { warn "[$site] 已取消"; return 0; }
  fi

  # 5) 服务器端时间戳备份 + 清理旧备份
  if [ "$DO_BACKUP" -eq 1 ]; then
    local stamp bak
    stamp="$(date +%Y%m%d-%H%M%S)"
    bak="${webroot%/}.bak-${site}-${stamp}"
    info "[$site] 服务器端备份 → $bak"
    ssh "${SSH_OPTS[@]}" "$remote" \
      "set -e; if [ -d '$webroot' ]; then cp -a '$webroot' '$bak'; fi; \
       ls -dt '${webroot%/}'.bak-${site}-* 2>/dev/null | tail -n +$((DEPLOY_KEEP_BACKUPS+1)) | xargs -r rm -rf; \
       true"
    ok "[$site] 备份完成（保留最近 $DEPLOY_KEEP_BACKUPS 份）"
  else
    warn "[$site] 跳过备份（--no-backup）"
  fi

  # 6) 正式发布
  info "[$site] rsync 发布中…"
  ssh "${SSH_OPTS[@]}" "$remote" "mkdir -p '$webroot'"
  rsync -az --delete --itemize-changes -e "$RSYNC_SSH" \
    "$distdir"/ "${remote}:${webroot}/"
  ok "[$site] 已发布到 https://$(site_domain "$site")/"
}

# ---------- 主流程 ----------
info "仓库根: $REPO_ROOT"
info "目标: $TARGET  |  dry-run=$DRY_RUN build=$DO_BUILD backup=$DO_BACKUP"

if [ "$TARGET" = "all" ]; then
  for s in docs design www; do deploy_site "$s"; done
else
  deploy_site "$TARGET"
fi

echo ""
ok "全部完成。"
if [ "$DRY_RUN" -eq 0 ]; then
  echo -e "${YELLOW}提示：${NC}发布后建议硬刷新浏览器（Ctrl+Shift+R）确认，VitePress sidebar 打进 JS bundle 有缓存。"
fi
