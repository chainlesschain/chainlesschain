#!/bin/bash

# ChainlessChain 开发环境启动脚本
# 使用 sql.js 作为数据库后端

echo "======================================"
echo "ChainlessChain 开发环境启动"
echo "======================================"
echo ""
echo "数据库: sql.js (JavaScript SQLite)"
echo "Node.js: $(node --version)"
echo "Electron: $(npx electron --version)"
echo ""

# 确保使用 Node.js 22
if ! node --version | grep -q "v22"; then
    echo "⚠️  警告: 建议使用 Node.js 22"
    echo "   运行: nvm use 22"
    echo ""
fi

# 构建主进程
echo "📦 构建主进程..."
npm run build:main

if [ $? -ne 0 ]; then
    echo "❌ 主进程构建失败"
    exit 1
fi

echo ""
echo "✅ 主进程构建成功"
echo ""
echo "🚀 启动应用..."
echo ""

# 启动应用
npm run dev
