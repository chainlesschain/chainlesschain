#!/bin/bash
# ChainlessChain 版本管理脚本
# 用于更新项目版本号并创建 git tag

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 显示使用方法
show_usage() {
    cat << EOF
ChainlessChain 版本管理工具

使用方法:
  $0 <bump_type>              # 自动递增版本号
  $0 <version>                # 手动指定版本号

Bump 类型:
  major    - 大版本更新 (1.0.0 -> 2.0.0)
  minor    - 小版本更新 (1.0.0 -> 1.1.0)
  patch    - 补丁更新 (1.0.0 -> 1.0.1)

示例:
  $0 major                    # 递增主版本号
  $0 minor                    # 递增次版本号
  $0 patch                    # 递增补丁版本号
  $0 v1.2.3                   # 设置为指定版本 v1.2.3
  $0 1.2.3                    # 设置为指定版本 v1.2.3 (自动添加 v)
EOF
    exit 0
}

# 检查参数
if [ -z "$1" ] || [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    show_usage
fi

BUMP_TYPE="$1"

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DESKTOP_APP_DIR="${PROJECT_ROOT}/desktop-app-vue"

cd "$PROJECT_ROOT"

# 检查 git 工作区是否干净
if [ -n "$(git status --porcelain)" ]; then
    warning "Git 工作区有未提交的更改"
    read -p "是否继续？(y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error "操作已取消"
    fi
fi

# 获取当前版本
CURRENT_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
CURRENT_VERSION=${CURRENT_VERSION#v}  # 移除 v 前缀

info "当前版本: v${CURRENT_VERSION}"

# 解析版本号
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]%%[-+]*}"  # 移除 pre-release 和 build metadata

# 计算新版本号
case "$BUMP_TYPE" in
    major)
        NEW_VERSION="$((MAJOR + 1)).0.0"
        ;;
    minor)
        NEW_VERSION="${MAJOR}.$((MINOR + 1)).0"
        ;;
    patch)
        NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
        ;;
    v*)
        NEW_VERSION="${BUMP_TYPE#v}"
        ;;
    *)
        # 假设是直接指定版本号
        if [[ $BUMP_TYPE =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
            NEW_VERSION="$BUMP_TYPE"
        else
            error "无效的版本号或 bump 类型: $BUMP_TYPE"
        fi
        ;;
esac

# 确保新版本有效
if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    error "无效的版本号: $NEW_VERSION"
fi

info "新版本: v${NEW_VERSION}"

# 确认更新
read -p "确认将版本从 v${CURRENT_VERSION} 更新到 v${NEW_VERSION}？(y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    error "操作已取消"
fi

# 更新 package.json 文件
info "更新 package.json 文件..."

# 根目录 package.json
if [ -f "package.json" ]; then
    sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" package.json
    rm package.json.bak 2>/dev/null || true
    info "已更新: package.json"
fi

# desktop-app-vue package.json
if [ -f "${DESKTOP_APP_DIR}/package.json" ]; then
    sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" "${DESKTOP_APP_DIR}/package.json"
    rm "${DESKTOP_APP_DIR}/package.json.bak" 2>/dev/null || true
    info "已更新: desktop-app-vue/package.json"
fi

# 更新 CHANGELOG.md (如果存在)
if [ -f "CHANGELOG.md" ]; then
    TODAY=$(date +%Y-%m-%d)

    # 在 CHANGELOG.md 顶部插入新版本
    {
        echo "## [${NEW_VERSION}] - ${TODAY}"
        echo ""
        echo "### Added"
        echo "- TODO: 添加新功能说明"
        echo ""
        echo "### Changed"
        echo "- TODO: 添加更改说明"
        echo ""
        echo "### Fixed"
        echo "- TODO: 添加修复说明"
        echo ""
        cat CHANGELOG.md
    } > CHANGELOG.md.tmp
    mv CHANGELOG.md.tmp CHANGELOG.md

    info "已更新: CHANGELOG.md (请手动编辑更新日志)"
fi

success "版本号更新完成"
echo ""

# 提交更改
info "提交更改..."
git add package.json "${DESKTOP_APP_DIR}/package.json" CHANGELOG.md 2>/dev/null || true
git commit -m "chore(release): bump version to v${NEW_VERSION}" || warning "没有需要提交的更改"

# 创建 git tag
info "创建 git tag..."
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

success "Git tag v${NEW_VERSION} 创建成功"
echo ""

# 显示后续步骤
echo "==========================================="
echo "  ✅ 版本更新完成！"
echo "==========================================="
echo ""
echo "新版本: v${NEW_VERSION}"
echo ""
echo "后续步骤:"
echo "  1. 推送代码和标签:"
echo "     git push && git push --tags"
echo ""
echo "  2. 触发 GitHub Actions 自动构建:"
echo "     - GitHub Actions 会自动检测到新 tag 并开始构建"
echo ""
echo "  3. 或者使用本地构建脚本:"
echo "     cd packaging/scripts"
echo "     ./release-local.sh v${NEW_VERSION}"
echo ""
echo "  4. 手动触发 GitHub Actions workflow:"
echo "     gh workflow run release.yml -f version=v${NEW_VERSION}"
echo ""
