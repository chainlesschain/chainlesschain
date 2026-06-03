#!/bin/bash
# ChainlessChain 本地发布脚本（基于 gh CLI）
# 用于在本地机器上构建多平台离线安装包并发布到 GitHub Releases

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 显示横幅
echo "==========================================="
echo "  ChainlessChain 本地多平台发布工具"
echo "==========================================="
echo ""

# 检查必要的工具
info "检查必要工具..."

if ! command -v gh &> /dev/null; then
    error "GitHub CLI (gh) 未安装。请访问: https://cli.github.com/"
fi

if ! command -v docker &> /dev/null; then
    error "Docker 未安装。请访问: https://www.docker.com/"
fi

if ! command -v node &> /dev/null; then
    error "Node.js 未安装。请访问: https://nodejs.org/"
fi

success "所有必要工具已安装"
echo ""

# 检查 Docker 是否运行
info "检查 Docker 状态..."
if ! docker info &> /dev/null; then
    error "Docker 未运行。请启动 Docker Desktop 后重试。"
fi
success "Docker 正在运行"
echo ""

# 检查 gh 是否已登录
info "检查 GitHub CLI 登录状态..."
if ! gh auth status &> /dev/null; then
    error "GitHub CLI 未登录。请运行: gh auth login"
fi
success "GitHub CLI 已登录"
echo ""

# 获取版本号
if [ -z "$1" ]; then
    echo "使用方法: $0 <version> [options]"
    echo ""
    echo "示例:"
    echo "  $0 v0.16.0              # 创建正式版本"
    echo "  $0 v0.16.0-beta.1       # 创建预发布版本"
    echo "  $0 v0.16.0 --draft      # 创建草稿版本"
    echo ""
    exit 1
fi

VERSION="$1"
DRAFT=""
PRERELEASE=""

# 解析参数
shift
while [[ $# -gt 0 ]]; do
    case $1 in
        --draft)
            DRAFT="--draft"
            shift
            ;;
        --prerelease)
            PRERELEASE="--prerelease"
            shift
            ;;
        *)
            warning "未知参数: $1"
            shift
            ;;
    esac
done

# 确保版本号以 v 开头
if [[ ! $VERSION =~ ^v ]]; then
    VERSION="v${VERSION}"
fi

info "发布版本: ${VERSION}"
if [ -n "$DRAFT" ]; then
    warning "草稿模式: 发布将标记为草稿"
fi
if [ -n "$PRERELEASE" ]; then
    warning "预发布模式: 发布将标记为预发布版本"
fi
echo ""

# 确认发布
read -p "确认发布版本 ${VERSION}？(y/N): " -n 1 -r
echo
if [[ ! $RRESPONSE =~ ^[Yy]$ ]]; then
    error "发布已取消"
fi

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PACKAGING_DIR="${PROJECT_ROOT}/packaging"
DESKTOP_APP_DIR="${PROJECT_ROOT}/desktop-app-vue"
RELEASE_DIR="${PROJECT_ROOT}/release-output"

cd "$PROJECT_ROOT"

# 清理之前的构建
info "清理之前的构建..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Step 1: 导出 Docker 镜像
info "Step 1/5: 导出 Docker 镜像..."
cd "$PACKAGING_DIR"

if [ ! -f "export-docker-images.sh" ]; then
    warning "export-docker-images.sh 不存在，使用 .bat 版本"
    ./export-docker-images.bat
else
    chmod +x export-docker-images.sh
    ./export-docker-images.sh
fi

# 验证 Docker 镜像已导出
if [ ! -d "docker-images" ] || [ -z "$(ls -A docker-images/*.tar 2>/dev/null)" ]; then
    error "Docker 镜像导出失败"
fi

success "Docker 镜像导出完成"
echo ""

# 显示镜像大小
info "Docker 镜像列表:"
du -sh docker-images/*.tar
echo ""

# Step 2: 安装依赖
info "Step 2/5: 安装依赖..."
cd "$PROJECT_ROOT"
npm ci

cd "$DESKTOP_APP_DIR"
npm ci

success "依赖安装完成"
echo ""

# Step 3: 构建应用
info "Step 3/5: 构建应用..."
cd "$DESKTOP_APP_DIR"

info "构建主进程..."
npm run build:main

info "构建渲染进程..."
NODE_ENV=production npm run build

success "应用构建完成"
echo ""

# Step 4: 打包（仅当前平台）
info "Step 4/5: 打包当前平台..."
cd "$DESKTOP_APP_DIR"

# 检测当前平台
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$PLATFORM" in
    linux*)
        info "检测到 Linux 平台，打包 DEB、RPM、ZIP..."
        SKIP_BACKEND_CHECK=true npx electron-forge make --platform=linux --arch=x64 --targets=@electron-forge/maker-deb
        SKIP_BACKEND_CHECK=true npx electron-forge make --platform=linux --arch=x64 --targets=@electron-forge/maker-rpm
        SKIP_BACKEND_CHECK=true npx electron-forge make --platform=linux --arch=x64 --targets=@electron-forge/maker-zip

        # 复制文件
        find out/make -name "*.deb" -exec cp {} "$RELEASE_DIR/" \;
        find out/make -name "*.rpm" -exec cp {} "$RELEASE_DIR/" \;
        find out/make -name "*.zip" -exec cp {} "$RELEASE_DIR/ChainlessChain-Linux-x64.zip" \;
        ;;
    darwin*)
        info "检测到 macOS 平台，打包 DMG、ZIP..."
        SKIP_BACKEND_CHECK=true npm run make

        # 复制文件
        find out/make -name "*.dmg" -exec cp {} "$RELEASE_DIR/" \;
        find out/make -name "*.zip" -exec cp {} "$RELEASE_DIR/ChainlessChain-macOS-Universal.zip" \;
        ;;
    msys*|mingw*|cygwin*)
        info "检测到 Windows 平台，打包 EXE、ZIP..."
        SKIP_BACKEND_CHECK=true npm run make:win

        # 复制文件
        find out/make -name "*.exe" -exec cp {} "$RELEASE_DIR/" \;
        find out/make -name "*.zip" -exec cp {} "$RELEASE_DIR/ChainlessChain-Windows-x64.zip" \;
        ;;
    *)
        error "不支持的平台: $PLATFORM"
        ;;
esac

success "打包完成"
echo ""

# 显示生成的文件
info "生成的安装包:"
ls -lh "$RELEASE_DIR"
echo ""

# Step 5: 创建 GitHub Release
info "Step 5/5: 创建 GitHub Release..."
cd "$PROJECT_ROOT"

# 生成 Release Notes
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$PREV_TAG" ]; then
    CHANGELOG="Initial release"
else
    CHANGELOG=$(git log ${PREV_TAG}..HEAD --pretty=format:"- %s (%h)" --no-merges)
fi

# 创建临时 release notes 文件
RELEASE_NOTES_FILE="${RELEASE_DIR}/release-notes.md"
cat > "$RELEASE_NOTES_FILE" << EOF
## 🎉 ChainlessChain ${VERSION}

### 📦 离线 Docker 版本（完全离线安装）

**本安装包包含完整的 Docker 镜像**，可在无网络环境下完成安装和使用。

- ✅ PostgreSQL 16 Alpine (~90 MB)
- ✅ Redis 7 Alpine (~30 MB)
- ✅ Qdrant v1.12.5 (~120 MB)
- ✅ Ollama Latest (~500 MB)

---

### 📋 安装步骤

1. **安装 Docker Desktop**（一次性）
   - Windows/Mac: https://www.docker.com/products/docker-desktop/
   - Linux: \`sudo apt-get install docker.io docker-compose\`

2. **安装 ChainlessChain** - 下载对应平台的安装包并安装

3. **加载 Docker 镜像**（首次安装）
   - Windows: 运行 \`load-docker-images.bat\`
   - Linux/Mac: 运行 \`./load-docker-images.sh\`

4. **启动服务**
   - Windows: 运行 \`start-services.bat\`
   - Linux/Mac: 运行 \`./start-services.sh\`

5. **启动应用** - 启动 ChainlessChain 桌面应用即可使用！

---

### 📚 文档

- 📖 [快速开始指南](https://github.com/\$GITHUB_REPOSITORY/blob/main/packaging/docs/QUICK_START_OFFLINE.md)
- 📖 [完整安装文档](https://github.com/\$GITHUB_REPOSITORY/blob/main/packaging/docs/DOCKER_OFFLINE_PACKAGING.md)
- 🔧 [故障排除](https://github.com/\$GITHUB_REPOSITORY/blob/main/packaging/docs/DOCKER_OFFLINE_PACKAGING.md#故障排除)

---

### 📝 更新日志

${CHANGELOG}

EOF

if [ -n "$PREV_TAG" ]; then
    echo "" >> "$RELEASE_NOTES_FILE"
    echo "**代码对比**: https://github.com/\$GITHUB_REPOSITORY/compare/${PREV_TAG}...${VERSION}" >> "$RELEASE_NOTES_FILE"
fi

# 使用 gh CLI 创建 release
GH_ARGS="--title \"ChainlessChain ${VERSION}\" --notes-file \"${RELEASE_NOTES_FILE}\""

if [ -n "$DRAFT" ]; then
    GH_ARGS="$GH_ARGS --draft"
fi

if [ -n "$PRERELEASE" ]; then
    GH_ARGS="$GH_ARGS --prerelease"
fi

info "创建 GitHub Release..."
eval gh release create "${VERSION}" ${GH_ARGS} "${RELEASE_DIR}"/*.{exe,dmg,deb,rpm,zip} 2>/dev/null || \
eval gh release create "${VERSION}" ${GH_ARGS} "${RELEASE_DIR}"/*

success "GitHub Release 创建成功！"
echo ""

# 显示 Release URL
REPO_URL=$(git remote get-url origin | sed 's/\.git$//')
RELEASE_URL="${REPO_URL}/releases/tag/${VERSION}"

echo "==========================================="
echo "  🎉 发布完成！"
echo "==========================================="
echo ""
echo "📦 发布版本: ${VERSION}"
echo "🔗 Release URL: ${RELEASE_URL}"
echo ""
echo "📂 本地文件位置: ${RELEASE_DIR}"
ls -lh "${RELEASE_DIR}"
echo ""

success "所有步骤完成！"
