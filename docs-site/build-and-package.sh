#!/bin/bash

# 确保 UTF-8 编码，防止中文文件名乱码
export LANG=zh_CN.UTF-8
export LC_ALL=zh_CN.UTF-8

# 动态读取产品版本（来源：仓库根 package.json.productVersion，单一真值）
ROOT_PKG="$(cd "$(dirname "$0")/.." && pwd)/package.json"
PRODUCT_VERSION="$(node -e "console.log(require('${ROOT_PKG//\\/\\\\}').productVersion)" 2>/dev/null || echo "")"
if [ -z "$PRODUCT_VERSION" ]; then
    echo "❌ 错误: 无法从 ${ROOT_PKG} 读取 productVersion，请确保 Node.js 可用"
    exit 1
fi

echo ""
echo "========================================"
echo "  文档网站打包脚本 ${PRODUCT_VERSION}"
echo "========================================"
echo ""

# 检查 Node.js
echo "[1/5] 检查环境..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未检测到 Node.js"
    exit 1
fi
echo "✅ Node.js 已安装: $(node --version)"

# 检查依赖
echo ""
echo "[2/5] 检查依赖..."
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
else
    echo "✅ 依赖已存在"
fi

# 清理旧构建
echo ""
echo "[3/5] 清理旧构建..."
if [ -d "docs/.vitepress/dist" ]; then
    rm -rf docs/.vitepress/dist
    echo "✅ 已清理旧构建"
fi
if [ -d "docs/.vitepress/cache" ]; then
    rm -rf docs/.vitepress/cache
    echo "✅ 已清理缓存"
fi

# 构建
echo ""
echo "[4/5] 构建生产版本..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 构建失败"
    exit 1
fi
echo "✅ 构建成功"

# 打包
echo ""
echo "[5/5] 打包文件..."
DIST_DIR="docs/.vitepress/dist"
PACKAGE_NAME="chainlesschain-docs-${PRODUCT_VERSION}-$(date +%Y%m%d-%H%M).tar.gz"

if [ -f "$PACKAGE_NAME" ]; then
    rm "$PACKAGE_NAME"
fi

# 使用 POSIX 格式确保 UTF-8 中文文件名正确存储
tar --format=posix -czf "$PACKAGE_NAME" -C "$DIST_DIR" .

if [ -f "$PACKAGE_NAME" ]; then
    echo "✅ 打包成功"
    echo ""
    echo "========================================"
    echo "  打包完成！"
    echo "========================================"
    echo ""
    echo "📦 文件: $PACKAGE_NAME"
    echo "📊 大小: $(du -h "$PACKAGE_NAME" | cut -f1)"
    echo "📁 位置: $(pwd)/$PACKAGE_NAME"
    echo ""
    echo "📄 构建目录: $DIST_DIR"
    echo "   文件数: $(find "$DIST_DIR" -type f | wc -l)"
    echo ""
    echo "下一步:"
    echo "  1. 解压: tar -xzf $PACKAGE_NAME"
    echo "  2. 上传到服务器"
    echo "  3. 或运行 'npm run preview' 本地预览"
    echo ""
else
    echo "❌ 打包失败"
    exit 1
fi
