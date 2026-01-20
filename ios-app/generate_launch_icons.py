#!/usr/bin/env python3
"""
ChainlessChain iOS 应用启动图标生成器
生成专业的渐变图标,包含 "CC" 标识和链条元素
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_gradient_background(size, color1, color2):
    """创建渐变背景"""
    base = Image.new('RGB', (size, size), color1)
    top = Image.new('RGB', (size, size), color2)
    mask = Image.new('L', (size, size))
    mask_data = []
    for y in range(size):
        for x in range(size):
            # 对角线渐变
            mask_data.append(int(255 * ((x + y) / (size * 2))))
    mask.putdata(mask_data)
    base.paste(top, (0, 0), mask)
    return base

def draw_chain_link(draw, center_x, center_y, size, color, width):
    """绘制链条环节"""
    # 外圈
    draw.ellipse(
        [center_x - size, center_y - size//2, center_x + size, center_y + size//2],
        outline=color,
        width=width
    )
    # 内部连接
    draw.rectangle(
        [center_x - size//3, center_y - size//2, center_x + size//3, center_y + size//2],
        fill=color
    )

def create_launch_icon(size, filename):
    """创建启动图标"""
    # 颜色定义
    color1 = (0, 84, 145)    # #005491
    color2 = (0, 168, 232)   # #00A8E8
    white = (255, 255, 255)

    # 创建渐变背景
    img = create_gradient_background(size, color1, color2)
    draw = ImageDraw.Draw(img)

    # 计算中心点
    center_x = size // 2
    center_y = size // 2

    # 绘制装饰性圆环
    ring_radius = int(size * 0.42)
    ring_width = max(2, size // 100)
    draw.ellipse(
        [center_x - ring_radius, center_y - ring_radius,
         center_x + ring_radius, center_y + ring_radius],
        outline=white + (100,),  # 半透明白色
        width=ring_width
    )

    # 绘制内部圆形背景
    inner_radius = int(size * 0.35)
    draw.ellipse(
        [center_x - inner_radius, center_y - inner_radius,
         center_x + inner_radius, center_y + inner_radius],
        fill=white + (230,)  # 几乎不透明的白色
    )

    # 绘制链条图标(简化版)
    chain_size = int(size * 0.12)
    chain_width = max(3, size // 50)

    # 左侧链环
    left_x = center_x - int(size * 0.15)
    draw.ellipse(
        [left_x - chain_size, center_y - chain_size,
         left_x + chain_size, center_y + chain_size],
        outline=color1,
        width=chain_width
    )

    # 右侧链环
    right_x = center_x + int(size * 0.15)
    draw.ellipse(
        [right_x - chain_size, center_y - chain_size,
         right_x + chain_size, center_y + chain_size],
        outline=color1,
        width=chain_width
    )

    # 中间连接
    connect_width = int(size * 0.05)
    draw.rectangle(
        [left_x + chain_size//2, center_y - connect_width//2,
         right_x - chain_size//2, center_y + connect_width//2],
        fill=color1
    )

    # 添加 "CC" 文字 (如果尺寸足够大)
    if size >= 200:
        try:
            # 尝试使用系统字体
            font_size = int(size * 0.25)
            try:
                # macOS 系统字体
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
            except:
                try:
                    # 备选字体
                    font = ImageFont.truetype("/Library/Fonts/Arial.ttf", font_size)
                except:
                    # 使用默认字体
                    font = ImageFont.load_default()

            text = "CC"
            # 获取文字边界框
            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]

            # 在下方绘制文字
            text_y = center_y + int(size * 0.2)
            draw.text(
                (center_x - text_width//2, text_y - text_height//2),
                text,
                fill=white,
                font=font
            )
        except Exception as e:
            print(f"警告: 无法添加文字 - {e}")

    # 保存图片
    img.save(filename, 'PNG')
    print(f"✓ 已创建: {filename} ({size}x{size})")

def main():
    # 设置路径
    base_path = "/Users/mac/Documents/code2/chainlesschain/ios-app/ChainlessChain/Resources/Assets.xcassets/LaunchIcon.imageset"

    # 确保目录存在
    os.makedirs(base_path, exist_ok=True)

    print("ChainlessChain 启动图标生成器")
    print("=" * 50)
    print()

    # 生成三个尺寸的启动图标
    sizes = [
        (200, "LaunchIcon.png"),       # @1x
        (400, "LaunchIcon@2x.png"),    # @2x
        (600, "LaunchIcon@3x.png"),    # @3x
    ]

    for size, filename in sizes:
        filepath = os.path.join(base_path, filename)
        create_launch_icon(size, filepath)

    print()
    print("=" * 50)
    print("✓ 所有启动图标已生成!")
    print()
    print("下一步:")
    print("1. 在 Xcode 中打开项目")
    print("2. 查看 Assets.xcassets/LaunchIcon")
    print("3. 运行应用查看启动动画效果")
    print()
    print("提示: 如需自定义图标,可以使用设计工具创建")
    print("      然后替换生成的 PNG 文件")

if __name__ == "__main__":
    main()
