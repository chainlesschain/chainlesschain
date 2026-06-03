#!/bin/bash
# ChainlessChain 启动图标占位符生成器
# 使用 macOS 内置的 sips 工具创建简单的占位图标

set -e

ASSETS_DIR="/Users/mac/Documents/code2/chainlesschain/ios-app/ChainlessChain/Resources/Assets.xcassets/LaunchIcon.imageset"

echo "ChainlessChain 启动图标占位符生成器"
echo "======================================================"
echo ""
echo "注意: 此脚本创建简单的蓝色占位图标"
echo "      建议后续使用设计工具创建专业图标"
echo ""

# 确保目录存在
mkdir -p "$ASSETS_DIR"

# 创建临时目录
TEMP_DIR=$(mktemp -d)
echo "临时目录: $TEMP_DIR"

# 使用 ImageMagick (如果可用) 或提供说明
if command -v convert &> /dev/null; then
    echo "✓ 检测到 ImageMagick,使用专业方式生成..."

    # 生成渐变图标
    for SIZE in 200 400 600; do
        if [ $SIZE -eq 200 ]; then
            FILENAME="LaunchIcon.png"
        elif [ $SIZE -eq 400 ]; then
            FILENAME="LaunchIcon@2x.png"
        else
            FILENAME="LaunchIcon@3x.png"
        fi

        # 创建渐变背景
        convert -size ${SIZE}x${SIZE} \
            gradient:'#005491-#00A8E8' \
            -swirl 180 \
            "$ASSETS_DIR/$FILENAME"

        echo "✓ 已创建: $FILENAME (${SIZE}x${SIZE})"
    done
else
    echo "⚠ 未检测到 ImageMagick"
    echo ""
    echo "请使用以下方式之一创建图标:"
    echo ""
    echo "1. 安装 ImageMagick 后重新运行此脚本:"
    echo "   brew install imagemagick"
    echo "   bash generate_simple_launch_icons.sh"
    echo ""
    echo "2. 使用在线工具生成图标:"
    echo "   - https://appiconmaker.co/"
    echo "   - https://makeappicon.com/"
    echo ""
    echo "3. 使用 Python 脚本 (需要 Pillow):"
    echo "   python3 -m venv venv"
    echo "   source venv/bin/activate"
    echo "   pip install Pillow"
    echo "   python3 generate_launch_icons.py"
    echo ""
    echo "所需图标尺寸:"
    echo "  - LaunchIcon.png (200x200)"
    echo "  - LaunchIcon@2x.png (400x400)"
    echo "  - LaunchIcon@3x.png (600x600)"
    echo ""
    echo "目标目录:"
    echo "  $ASSETS_DIR"
    echo ""

    # 创建简单的纯色图标作为极简占位符
    echo "正在创建纯色占位图标..."

    # 创建一个简单的蓝色正方形 PNG
    cat > "$TEMP_DIR/create_simple.py" << 'EOF'
import os
import struct

def create_simple_png(width, height, color, filename):
    """创建简单的纯色 PNG (不需要 PIL)"""
    # PNG 文件头
    png_header = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr_chunk = create_chunk(b'IHDR', ihdr_data)

    # IDAT chunk (图像数据)
    pixels = b''
    for y in range(height):
        pixels += b'\x00'  # 滤波器类型
        for x in range(width):
            pixels += bytes(color)  # RGB

    import zlib
    compressed = zlib.compress(pixels, 9)
    idat_chunk = create_chunk(b'IDAT', compressed)

    # IEND chunk
    iend_chunk = create_chunk(b'IEND', b'')

    # 写入文件
    with open(filename, 'wb') as f:
        f.write(png_header)
        f.write(ihdr_chunk)
        f.write(idat_chunk)
        f.write(iend_chunk)

def create_chunk(chunk_type, data):
    """创建 PNG chunk"""
    length = struct.pack('>I', len(data))
    import binascii
    crc = binascii.crc32(chunk_type + data) & 0xffffffff
    crc_bytes = struct.pack('>I', crc)
    return length + chunk_type + data + crc_bytes

# 蓝色
color = (0, 84, 145)

# 生成三个尺寸
sizes = [
    (200, 'LaunchIcon.png'),
    (400, 'LaunchIcon@2x.png'),
    (600, 'LaunchIcon@3x.png')
]

assets_dir = os.environ.get('ASSETS_DIR', '.')
for size, filename in sizes:
    filepath = os.path.join(assets_dir, filename)
    create_simple_png(size, size, color, filepath)
    print(f'✓ 已创建: {filename} ({size}x{size})')
EOF

    ASSETS_DIR="$ASSETS_DIR" python3 "$TEMP_DIR/create_simple.py"
fi

# 清理
rm -rf "$TEMP_DIR"

echo ""
echo "======================================================"
echo "✓ 启动图标已生成!"
echo ""
echo "下一步:"
echo "  1. 在 Xcode 中打开项目"
echo "  2. 查看 Assets.xcassets/LaunchIcon"
echo "  3. 运行应用查看效果"
echo ""
echo "建议:"
echo "  使用专业设计工具创建更精美的图标"
echo "  参考: LAUNCH_ANIMATION_GUIDE.md"
echo ""
