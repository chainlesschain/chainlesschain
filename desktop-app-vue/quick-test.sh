#!/bin/bash
###############################################################################
# 快速测试脚本 - 验证 Bash 脚本是否正常工作
###############################################################################

echo "===================================================================="
echo "  ChainlessChain Bash 脚本测试工具"
echo "===================================================================="
echo ""
echo "此脚本将验证您的环境是否正确配置"
echo ""

# 检查 Bash 版本
echo "[1/5] 检查 Bash 版本..."
echo "  Bash 版本: $BASH_VERSION"
if [ -z "$BASH_VERSION" ]; then
    echo "  [ERROR] 不在 Bash 环境中运行"
    exit 1
fi
echo "  ✓ Bash 环境正常"
echo ""

# 检查 Node.js
echo "[2/5] 检查 Node.js..."
if command -v node &> /dev/null; then
    echo "  ✓ Node.js 已安装: $(node --version)"
else
    echo "  ✗ Node.js 未安装"
    echo "    请从 https://nodejs.org/ 安装"
fi
echo ""

# 检查 npm
echo "[3/5] 检查 npm..."
if command -v npm &> /dev/null; then
    echo "  ✓ npm 已安装: $(npm --version)"
else
    echo "  ✗ npm 未安装"
fi
echo ""

# 检查脚本文件
echo "[4/5] 检查脚本文件..."
if [ -f "build-windows-package-standalone.sh" ]; then
    echo "  ✓ build-windows-package-standalone.sh 存在"
    if [ -x "build-windows-package-standalone.sh" ]; then
        echo "    ✓ 具有执行权限"
    else
        echo "    ✗ 缺少执行权限，正在添加..."
        chmod +x build-windows-package-standalone.sh
        echo "    ✓ 执行权限已添加"
    fi
else
    echo "  ✗ build-windows-package-standalone.sh 不存在"
fi
echo ""

# 检查 Inno Setup (可选)
echo "[5/5] 检查 Inno Setup (可选)..."
if command -v iscc &> /dev/null; then
    echo "  ✓ iscc 在 PATH 中"
elif [ -f "/c/Program Files (x86)/Inno Setup 6/iscc.exe" ]; then
    echo "  ✓ Inno Setup 已安装"
else
    echo "  ✗ Inno Setup 未安装（可选）"
    echo "    如需生成安装包，请从 https://jrsoftware.org/isdl.php 安装"
fi
echo ""

# 总结
echo "===================================================================="
echo "  测试完成"
echo "===================================================================="
echo ""

# 检查所有必需组件
REQUIRED_OK=true
if ! command -v node &> /dev/null; then
    REQUIRED_OK=false
    echo "  ✗ 缺少必需组件: Node.js"
fi
if ! command -v npm &> /dev/null; then
    REQUIRED_OK=false
    echo "  ✗ 缺少必需组件: npm"
fi
if [ ! -f "build-windows-package-standalone.sh" ]; then
    REQUIRED_OK=false
    echo "  ✗ 缺少必需组件: build-windows-package-standalone.sh"
fi

if [ "$REQUIRED_OK" = true ]; then
    echo "  ✓ 所有必需组件都已就绪！"
    echo ""
    echo "  您可以运行以下命令开始打包："
    echo "    ./build-windows-package-standalone.sh"
    echo ""
else
    echo "  ⚠ 请先安装缺少的组件"
    echo ""
fi

read -p "按 Enter 退出..."
