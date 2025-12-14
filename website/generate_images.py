#!/usr/bin/env python3
"""
ChainlessChain 图片资源生成器
自动生成网站所需的所有图片资源
"""

import os
from PIL import Image, ImageDraw, ImageFont
import qrcode

# 配置
OUTPUT_DIR = "images"
QR_DIR = os.path.join(OUTPUT_DIR, "qr")
PRODUCTS_DIR = os.path.join(OUTPUT_DIR, "products")
BADGES_DIR = os.path.join(OUTPUT_DIR, "badges")

# 创建目录
for directory in [OUTPUT_DIR, QR_DIR, PRODUCTS_DIR, BADGES_DIR]:
    os.makedirs(directory, exist_ok=True)

def generate_qr_code(url, filename, size=200):
    """生成二维码"""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    img = img.resize((size, size), Image.LANCZOS)
    img.save(filename)
    print(f"✅ 生成二维码: {filename}")

def generate_og_image(filename, width=1200, height=630):
    """生成 Open Graph 分享图"""
    # 创建渐变背景
    img = Image.new('RGB', (width, height), color='white')
    draw = ImageDraw.Draw(img)

    # 绘制渐变背景
    for y in range(height):
        r = int(102 + (240 - 102) * y / height)
        g = int(126 + (147 - 126) * y / height)
        b = int(234 + (251 - 234) * y / height)
        draw.rectangle([(0, y), (width, y + 1)], fill=(r, g, b))

    # 尝试加载字体
    try:
        title_font = ImageFont.truetype("arial.ttf", 80)
        subtitle_font = ImageFont.truetype("arial.ttf", 50)
        text_font = ImageFont.truetype("arial.ttf", 36)
        badge_font = ImageFont.truetype("arial.ttf", 28)
    except:
        # 如果找不到字体，使用默认字体
        title_font = ImageFont.load_default()
        subtitle_font = ImageFont.load_default()
        text_font = ImageFont.load_default()
        badge_font = ImageFont.load_default()

    # 绘制文字
    draw.text((width/2, 150), "ChainlessChain", font=title_font, fill='white', anchor='mm')
    draw.text((width/2, 240), "无链之链", font=subtitle_font, fill='white', anchor='mm')
    draw.text((width/2, 340), "让数据主权回归个人", font=text_font, fill='white', anchor='mm')
    draw.text((width/2, 400), "AI效率触手可及", font=text_font, fill='white', anchor='mm')

    # 绘制特性标签
    badges = ['🔒 硬件加密', '🤖 本地AI', '💾 离线可用', '🆓 永久免费']
    x_start = 200
    for i, badge in enumerate(badges):
        draw.text((x_start + i * 200, 520), badge, font=badge_font, fill='white', anchor='lm')

    img.save(filename)
    print(f"✅ 生成OG图片: {filename}")

def generate_product_screenshot(product_type, filename, width=800, height=600):
    """生成产品截图占位图"""
    img = Image.new('RGB', (width, height), color='#f5f7fa')
    draw = ImageDraw.Draw(img)

    # 顶部导航栏
    draw.rectangle([(0, 0), (width, 60)], fill='#1890ff')

    try:
        nav_font = ImageFont.truetype("arial.ttf", 24)
        title_font = ImageFont.truetype("arial.ttf", 48)
        subtitle_font = ImageFont.truetype("arial.ttf", 24)
        hint_font = ImageFont.truetype("arial.ttf", 20)
    except:
        nav_font = ImageFont.load_default()
        title_font = ImageFont.load_default()
        subtitle_font = ImageFont.load_default()
        hint_font = ImageFont.load_default()

    # Logo
    draw.text((20, 30), "🔗 ChainlessChain", font=nav_font, fill='white', anchor='lm')

    # 产品标题
    titles = {
        'knowledge-base': ('个人AI知识库', '硬件加密 + 本地AI'),
        'social': ('去中心化社交', '端到端加密 + P2P通信'),
        'trading': ('AI辅助交易', '智能匹配 + 智能合约')
    }

    title, subtitle = titles.get(product_type, ('产品名称', '产品描述'))
    draw.text((width/2, 130), title, font=title_font, fill='#2c3e50', anchor='mm')
    draw.text((width/2, 180), subtitle, font=subtitle_font, fill='#666666', anchor='mm')

    # 界面框架
    # 侧边栏
    draw.rectangle([(20, 220), (220, 540)], fill='white', outline='#e8e8e8')
    # 主内容区
    draw.rectangle([(240, 220), (780, 540)], fill='white', outline='#e8e8e8')

    # 占位元素
    for i in range(5):
        draw.rectangle([(30, 240 + i*60), (210, 280 + i*60)], fill='#e8e8e8')

    for i in range(3):
        draw.rectangle([(260, 240 + i*100), (760, 320 + i*100)], fill='#e8e8e8')

    # 底部提示
    draw.text((width/2, 570), '这是临时占位图，请替换为实际产品截图',
              font=hint_font, fill='#999999', anchor='mm')

    img.save(filename)
    print(f"✅ 生成产品截图: {filename}")

def generate_badge(badge_type, filename, width=200, height=80):
    """生成安全徽章"""
    img = Image.new('RGB', (width, height), color='white')
    draw = ImageDraw.Draw(img)

    # 背景颜色
    colors = {
        'ssl': '#52c41a',
        'level3': '#1890ff',
        'iso': '#722ed1'
    }

    color = colors.get(badge_type, '#1890ff')
    draw.rectangle([(0, 0), (width, height)], fill=color)

    # 边框
    draw.rectangle([(2, 2), (width-2, height-2)], outline='rgba(255,255,255,0.3)', width=2)

    try:
        icon_font = ImageFont.truetype("arial.ttf", 32)
        text_font = ImageFont.truetype("arial.ttf", 16)
    except:
        icon_font = ImageFont.load_default()
        text_font = ImageFont.load_default()

    # 图标和文字
    badges = {
        'ssl': ('🔒', 'SSL Secure'),
        'level3': ('✅', '等保三级'),
        'iso': ('🏆', 'ISO Certified')
    }

    icon, text = badges.get(badge_type, ('', 'Badge'))
    draw.text((40, height/2), icon, font=icon_font, fill='white', anchor='mm')
    draw.text((120, height/2), text, font=text_font, fill='white', anchor='mm')

    img.save(filename)
    print(f"✅ 生成徽章: {filename}")

def generate_logo(filename, width=200, height=60):
    """生成临时Logo"""
    img = Image.new('RGBA', (width, height), color=(102, 126, 234, 0))
    draw = ImageDraw.Draw(img)

    try:
        icon_font = ImageFont.truetype("arial.ttf", 40)
        text_font = ImageFont.truetype("arial.ttf", 28)
    except:
        icon_font = ImageFont.load_default()
        text_font = ImageFont.load_default()

    # 链条图标
    draw.text((10, 30), "🔗", font=icon_font, fill='white', anchor='lm')

    # 文字
    draw.text((60, 30), "ChainlessChain", font=text_font, fill='white', anchor='lm')

    img.save(filename)
    print(f"✅ 生成Logo: {filename}")

def main():
    """主函数：生成所有图片"""
    print("🎨 开始生成ChainlessChain图片资源...\n")

    # 1. 生成二维码
    print("📱 生成二维码...")
    generate_qr_code(
        "https://github.com/chainlesschain/chainlesschain/releases/latest",
        os.path.join(QR_DIR, "android-download.png")
    )
    generate_qr_code(
        "https://work.weixin.qq.com/ca/cawcde653996f7ecb2",
        os.path.join(QR_DIR, "wechat.png")
    )

    # 2. 生成 Open Graph 图片
    print("\n🖼️ 生成OG分享图...")
    generate_og_image(os.path.join(OUTPUT_DIR, "og-image.png"))

    # 3. 生成产品截图
    print("\n📸 生成产品截图...")
    generate_product_screenshot('knowledge-base',
                               os.path.join(PRODUCTS_DIR, "kb-screenshot.png"))
    generate_product_screenshot('social',
                               os.path.join(PRODUCTS_DIR, "social-screenshot.png"))
    generate_product_screenshot('trading',
                               os.path.join(PRODUCTS_DIR, "trading-screenshot.png"))

    # 4. 生成安全徽章
    print("\n🛡️ 生成安全徽章...")
    generate_badge('ssl', os.path.join(BADGES_DIR, "ssl-secure.png"))
    generate_badge('level3', os.path.join(BADGES_DIR, "level3-certified.png"))
    generate_badge('iso', os.path.join(BADGES_DIR, "iso-certified.png"))

    # 5. 生成Logo
    print("\n🔗 生成Logo...")
    generate_logo("logo.png")

    print("\n✨ 所有图片生成完成！")
    print("\n📁 生成的文件：")
    print("  - logo.png")
    print("  - images/og-image.png")
    print("  - images/qr/android-download.png")
    print("  - images/qr/wechat.png")
    print("  - images/products/kb-screenshot.png")
    print("  - images/products/social-screenshot.png")
    print("  - images/products/trading-screenshot.png")
    print("  - images/badges/ssl-secure.png")
    print("  - images/badges/level3-certified.png")
    print("  - images/badges/iso-certified.png")

    print("\n💡 提示：")
    print("  1. 这些是临时占位图，建议替换为实际的产品截图")
    print("  2. Logo建议找专业设计师设计")
    print("  3. 产品截图应使用真实界面截图")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        print("\n请确保已安装所需库：")
        print("  pip install Pillow qrcode[pil]")
