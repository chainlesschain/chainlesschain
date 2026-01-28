#!/bin/bash

echo ""
echo "========================================"
echo "  文档网站更新验证 v0.27.0"
echo "========================================"
echo ""

# 检查 Node.js
echo "[1/4] 检查 Node.js 环境..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未检测到 Node.js，请先安装 Node.js"
    exit 1
fi
echo "✅ Node.js 版本:"
node --version

echo ""
echo "[2/4] 检查依赖安装..."
if [ ! -d "node_modules" ]; then
    echo "📦 正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
else
    echo "✅ 依赖已安装"
fi

echo ""
echo "[3/4] 检查关键文件..."
missing=0

files=(
    "docs/index.md"
    "docs/changelog.md"
    "docs/chainlesschain/cowork.md"
    "docs/.vitepress/config.js"
)

for file in "${files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ 缺少文件: $file"
        missing=1
    fi
done

if [ $missing -eq 0 ]; then
    echo "✅ 所有关键文件存在"
else
    echo "❌ 部分文件缺失"
    exit 1
fi

echo ""
echo "[4/4] 验证版本信息..."
if grep -q "v0.27.0" docs/index.md; then
    echo "✅ 首页版本号已更新"
else
    echo "⚠️  警告: 首页可能未更新到 v0.27.0"
fi

if grep -q "Cowork" docs/index.md; then
    echo "✅ Cowork 特性已添加"
else
    echo "⚠️  警告: 首页可能缺少 Cowork 内容"
fi

echo ""
echo "========================================"
echo "  验证完成！"
echo "========================================"
echo ""
echo "下一步:"
echo "  1. 运行 'npm run dev' 启动开发服务器"
echo "  2. 访问 http://localhost:5173"
echo "  3. 检查页面内容和导航"
echo ""
