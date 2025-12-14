#!/bin/bash

echo "============================================"
echo "  ChainlessChain 图片资源生成器"
echo "============================================"
echo ""

# 检查Python是否安装
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未检测到Python 3，请先安装Python"
    echo ""
    echo "macOS安装: brew install python3"
    echo "Ubuntu安装: sudo apt install python3 python3-pip"
    exit 1
fi

echo "[1/3] 检查依赖..."

# 检查并安装Pillow
if ! python3 -c "import PIL" &> /dev/null; then
    echo "[提示] 正在安装Pillow..."
    pip3 install Pillow
fi

# 检查并安装qrcode
if ! python3 -c "import qrcode" &> /dev/null; then
    echo "[提示] 正在安装qrcode..."
    pip3 install "qrcode[pil]"
fi

echo ""
echo "[2/3] 开始生成图片..."
echo ""

python3 generate_images.py

if [ $? -eq 0 ]; then
    echo ""
    echo "[3/3] 完成！"
    echo ""
    echo "✅ 所有图片已生成到以下目录："
    echo "   - logo.png"
    echo "   - images/og-image.png"
    echo "   - images/qr/*.png"
    echo "   - images/products/*.png"
    echo "   - images/badges/*.png"
    echo ""
    echo "💡 提示："
    echo "   1. 这些是临时占位图，建议替换为实际设计"
    echo "   2. 使用TinyPNG压缩图片以提升加载速度"
    echo "   3. 产品截图应使用真实界面截图"
    echo ""
else
    echo ""
    echo "❌ 生成失败，请检查错误信息"
    echo ""
    exit 1
fi
