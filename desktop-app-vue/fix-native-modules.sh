#!/bin/bash

echo "=== 修复Native模块版本不匹配问题 ==="
echo ""

# 获取当前目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "步骤 1: 检查Electron版本..."
ELECTRON_VERSION=$(npx electron --version 2>/dev/null | tr -d 'v')
echo "Electron版本: $ELECTRON_VERSION"
echo ""

echo "步骤 2: 重新编译better-sqlite3-multiple-ciphers..."
echo "这将针对Electron使用的Node.js版本重新编译native模块"
echo ""

# 使用electron-rebuild重新编译
if command -v electron-rebuild &> /dev/null; then
    echo "使用electron-rebuild重新编译..."
    npx electron-rebuild -v $ELECTRON_VERSION
else
    echo "electron-rebuild未安装，正在安装..."
    npm install --save-dev electron-rebuild
    echo ""
    echo "重新编译..."
    npx electron-rebuild -v $ELECTRON_VERSION
fi

echo ""
echo "步骤 3: 验证修复..."
echo "尝试运行测试脚本..."
node test-project-create.js

echo ""
echo "=== 修复完成 ==="
