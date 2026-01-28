#!/bin/bash

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   ChainlessChain 官网本地预览启动器 v0.21.0              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "🚀 正在启动本地服务器..."
echo ""

# 检查Python是否安装
if command -v python3 &> /dev/null; then
    echo "✅ 使用 Python HTTP Server"
    echo "📍 访问地址："
    echo "   - 主页：http://localhost:8000"
    echo "   - 二维码生成器：http://localhost:8000/generate-qr-code.html"
    echo "   - 预览页面：http://localhost:8000/PREVIEW_v0.21.0.html"
    echo ""
    echo "💡 按 Ctrl+C 停止服务器"
    echo ""
    sleep 1

    # macOS自动打开浏览器
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open http://localhost:8000
    # Linux自动打开浏览器
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open http://localhost:8000 2>/dev/null || echo "请手动打开浏览器访问 http://localhost:8000"
    fi

    python3 -m http.server 8000
    exit 0
fi

# 检查Node.js是否安装
if command -v node &> /dev/null; then
    echo "✅ 使用 Node.js HTTP Server"
    echo "📦 正在安装 http-server..."
    npm install -g http-server
    echo ""
    echo "📍 访问地址："
    echo "   - 主页：http://localhost:8000"
    echo "   - 二维码生成器：http://localhost:8000/generate-qr-code.html"
    echo "   - 预览页面：http://localhost:8000/PREVIEW_v0.21.0.html"
    echo ""
    echo "💡 按 Ctrl+C 停止服务器"
    echo ""
    sleep 1

    # macOS自动打开浏览器
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open http://localhost:8000
    # Linux自动打开浏览器
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open http://localhost:8000 2>/dev/null || echo "请手动打开浏览器访问 http://localhost:8000"
    fi

    npx http-server -p 8000
    exit 0
fi

# 都没有安装
echo "❌ 未检测到 Python 或 Node.js"
echo ""
echo "请先安装以下任一工具："
echo "  1. Python 3.x - https://www.python.org/downloads/"
echo "  2. Node.js - https://nodejs.org/"
echo ""
echo "或者直接在浏览器中打开 index.html 文件"
echo ""
