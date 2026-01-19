#!/usr/bin/env python3
"""
ChainlessChain iOS App Icon Generator

This script generates placeholder app icons and launch icons for the iOS app.
It creates simple gradient icons with the app name.

Requirements:
    pip install Pillow

Usage:
    python3 generate_app_icons.py
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Configuration
ASSETS_DIR = "ChainlessChain/Resources/Assets.xcassets"
APP_ICON_DIR = f"{ASSETS_DIR}/AppIcon.appiconset"
LAUNCH_ICON_DIR = f"{ASSETS_DIR}/LaunchIcon.imageset"

# App icon sizes (iPhone and iPad)
APP_ICON_SIZES = [
    (40, "20@2x"),    # iPhone Notification 20pt @2x
    (60, "20@3x"),    # iPhone Notification 20pt @3x
    (58, "29@2x"),    # iPhone Settings 29pt @2x
    (87, "29@3x"),    # iPhone Settings 29pt @3x
    (80, "40@2x"),    # iPhone Spotlight 40pt @2x
    (120, "40@3x"),   # iPhone Spotlight 40pt @3x
    (120, "60@2x"),   # iPhone App 60pt @2x
    (180, "60@3x"),   # iPhone App 60pt @3x
    (20, "20@1x"),    # iPad Notification 20pt @1x
    (40, "20@2x"),    # iPad Notification 20pt @2x
    (29, "29@1x"),    # iPad Settings 29pt @1x
    (58, "29@2x"),    # iPad Settings 29pt @2x
    (40, "40@1x"),    # iPad Spotlight 40pt @1x
    (80, "40@2x"),    # iPad Spotlight 40pt @2x
    (76, "76@1x"),    # iPad App 76pt @1x
    (152, "76@2x"),   # iPad App 76pt @2x
    (167, "83.5@2x"), # iPad Pro App 83.5pt @2x
    (1024, "1024"),   # App Store
]

# Launch icon sizes
LAUNCH_ICON_SIZES = [
    (200, "LaunchIcon.png"),
    (400, "LaunchIcon@2x.png"),
    (600, "LaunchIcon@3x.png"),
]

def create_gradient_background(size, color1=(0, 84, 145), color2=(0, 168, 232)):
    """Create a gradient background."""
    image = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(image)

    for i in range(size):
        # Calculate gradient color
        ratio = i / size
        r = int(color1[0] * (1 - ratio) + color2[0] * ratio)
        g = int(color1[1] * (1 - ratio) + color2[1] * ratio)
        b = int(color1[2] * (1 - ratio) + color2[2] * ratio)

        # Draw horizontal line
        draw.line([(0, i), (size, i)], fill=(r, g, b))

    return image

def add_text_to_icon(image, text, size):
    """Add text to the icon."""
    draw = ImageDraw.Draw(image)

    # Try to use a system font, fallback to default
    try:
        # Calculate font size based on icon size
        font_size = int(size * 0.15)
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except:
        font = ImageFont.load_default()

    # Get text bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    # Calculate position (center)
    x = (size - text_width) // 2
    y = (size - text_height) // 2

    # Draw text with shadow
    shadow_offset = max(1, size // 100)
    draw.text((x + shadow_offset, y + shadow_offset), text, fill=(0, 0, 0, 128), font=font)
    draw.text((x, y), text, fill=(255, 255, 255), font=font)

    return image

def add_chain_symbol(image, size):
    """Add a simple chain link symbol to the icon."""
    draw = ImageDraw.Draw(image)

    # Calculate dimensions
    center_x = size // 2
    center_y = size // 2
    link_size = size // 4
    link_width = max(2, size // 40)

    # Draw two interlocking circles (chain links)
    # Left link
    left_x = center_x - link_size // 2
    draw.ellipse(
        [left_x - link_size//2, center_y - link_size//2,
         left_x + link_size//2, center_y + link_size//2],
        outline=(255, 255, 255),
        width=link_width
    )

    # Right link
    right_x = center_x + link_size // 2
    draw.ellipse(
        [right_x - link_size//2, center_y - link_size//2,
         right_x + link_size//2, center_y + link_size//2],
        outline=(255, 255, 255),
        width=link_width
    )

    return image

def generate_app_icons():
    """Generate all app icon sizes."""
    print("🎨 Generating app icons...")

    for size, name in APP_ICON_SIZES:
        print(f"  Creating {size}x{size} icon...")

        # Create gradient background
        icon = create_gradient_background(size)

        # Add chain symbol for larger icons
        if size >= 60:
            icon = add_chain_symbol(icon, size)

        # Add text for very large icons
        if size >= 120:
            icon = add_text_to_icon(icon, "CC", size)

        # Save icon
        filename = f"{APP_ICON_DIR}/icon-{name}.png"
        icon.save(filename, "PNG")

    print(f"✅ Generated {len(APP_ICON_SIZES)} app icons")

def generate_launch_icons():
    """Generate launch screen icons."""
    print("🚀 Generating launch icons...")

    for size, filename in LAUNCH_ICON_SIZES:
        print(f"  Creating {size}x{size} launch icon...")

        # Create gradient background
        icon = create_gradient_background(size)

        # Add chain symbol
        icon = add_chain_symbol(icon, size)

        # Add text
        icon = add_text_to_icon(icon, "ChainlessChain", size)

        # Save icon
        filepath = f"{LAUNCH_ICON_DIR}/{filename}"
        icon.save(filepath, "PNG")

    print(f"✅ Generated {len(LAUNCH_ICON_SIZES)} launch icons")

def create_readme():
    """Create a README for the icons."""
    readme_content = """# App Icons and Launch Icons

This directory contains auto-generated placeholder icons for the ChainlessChain iOS app.

## Replacing Icons

To replace these placeholder icons with your own designs:

1. **App Icons** (AppIcon.appiconset):
   - Create icons in the required sizes (see Contents.json)
   - Replace the generated `icon-*.png` files
   - Or use a tool like [AppIconMaker](https://appiconmaker.co/) to generate all sizes from a single 1024x1024 image

2. **Launch Icons** (LaunchIcon.imageset):
   - Replace `LaunchIcon.png` (200x200)
   - Replace `LaunchIcon@2x.png` (400x400)
   - Replace `LaunchIcon@3x.png` (600x600)

## Design Guidelines

- **App Icon**: Should be simple, recognizable, and work at small sizes
- **Launch Icon**: Can be more detailed, shown during app launch
- **Colors**: Use brand colors consistently
- **Style**: Follow iOS design guidelines (no transparency, rounded corners applied by system)

## Tools

- [Figma](https://www.figma.com/) - Design tool
- [Sketch](https://www.sketch.com/) - Design tool
- [AppIconMaker](https://appiconmaker.co/) - Icon generator
- [MakeAppIcon](https://makeappicon.com/) - Icon generator

---

Generated by: generate_app_icons.py
Date: 2026-01-19
"""

    with open(f"{ASSETS_DIR}/README.md", "w") as f:
        f.write(readme_content)

    print("📝 Created README.md")

def main():
    """Main function."""
    print("🚀 ChainlessChain iOS Icon Generator")
    print("=" * 50)

    # Check if Pillow is installed
    try:
        from PIL import Image
    except ImportError:
        print("❌ Error: Pillow is not installed")
        print("   Install it with: pip install Pillow")
        return

    # Check if directories exist
    if not os.path.exists(APP_ICON_DIR):
        print(f"❌ Error: {APP_ICON_DIR} does not exist")
        return

    if not os.path.exists(LAUNCH_ICON_DIR):
        print(f"❌ Error: {LAUNCH_ICON_DIR} does not exist")
        return

    # Generate icons
    generate_app_icons()
    generate_launch_icons()
    create_readme()

    print("")
    print("=" * 50)
    print("✅ All icons generated successfully!")
    print("")
    print("📋 Next steps:")
    print("  1. Review the generated icons in Xcode")
    print("  2. Replace with your own designs if needed")
    print("  3. See Assets.xcassets/README.md for details")

if __name__ == "__main__":
    main()
