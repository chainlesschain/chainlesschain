#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Android Launcher Icon Generator

Generates optimized launcher icons for all Android densities from a source image.
Reduces APK size by creating appropriately sized icons instead of using the same
large image for all densities.

Usage:
    python generate_icons.py

Requirements:
    pip install Pillow
"""

import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("[ERROR] Pillow library not found")
    print("[INFO] Install with: pip install Pillow")
    sys.exit(1)

# Android density configurations
DENSITIES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192
}

def get_project_root():
    """Find the project root directory (where assets/ is located)."""
    current = Path(__file__).resolve().parent
    while current != current.parent:
        if (current / 'assets').exists():
            return current
        current = current.parent
    raise FileNotFoundError("Could not find project root (no assets/ directory)")

def generate_icons(source_path, output_base, icon_names=['ic_launcher.png', 'ic_launcher_round.png']):
    """
    Generate Android launcher icons for all densities.

    Args:
        source_path: Path to source image (should be high resolution, e.g., 512x512+)
        output_base: Base output directory (e.g., android-app/app/src/main/res)
        icon_names: List of icon filenames to generate
    """
    print("=" * 60)
    print("Android Launcher Icon Generator")
    print("=" * 60)

    # Verify source image exists
    source = Path(source_path)
    if not source.exists():
        print(f"[ERROR] Source image not found: {source_path}")
        return False

    print(f"Source: {source}")

    # Open source image
    try:
        source_img = Image.open(source)
        print(f"Source size: {source_img.size[0]}x{source_img.size[1]} px")
        print(f"Color mode: {source_img.mode}")
    except Exception as e:
        print(f"[ERROR] opening source image: {e}")
        return False

    # Generate icons for each density
    total_size_before = 0
    total_size_after = 0

    print("\nGenerating icons...")
    print("-" * 60)

    for density, size in DENSITIES.items():
        output_dir = Path(output_base) / f'mipmap-{density}'
        output_dir.mkdir(parents=True, exist_ok=True)

        for icon_name in icon_names:
            output_path = output_dir / icon_name

            # Check existing size (before optimization)
            if output_path.exists():
                total_size_before += output_path.stat().st_size

            # Resize image with high-quality resampling
            icon = source_img.resize((size, size), Image.LANCZOS)

            # Save optimized PNG
            icon.save(output_path, optimize=True, quality=85)

            # Get new file size
            file_size = output_path.stat().st_size
            total_size_after += file_size

            print(f"[OK] {density:8s} {size:3d}x{size:<3d} -> {icon_name:24s} ({file_size / 1024:.1f} KB)")

    print("-" * 60)
    print(f"\nOptimization Results:")
    print(f"   Before: {total_size_before / 1024 / 1024:.2f} MB")
    print(f"   After:  {total_size_after / 1024:.2f} KB")
    print(f"   Saved:  {(total_size_before - total_size_after) / 1024 / 1024:.2f} MB")

    if total_size_before > 0:
        reduction = 100 * (1 - total_size_after / total_size_before)
        print(f"   Reduction: {reduction:.1f}%")

    print(f"\n[SUCCESS] Generated {len(DENSITIES) * len(icon_names)} icons!")
    return True

def main():
    """Main entry point."""
    try:
        # Find project root
        project_root = get_project_root()
        print(f"Project root: {project_root}\n")

        # Define paths
        source_path = project_root / 'assets' / 'logo.png'
        output_base = project_root / 'android-app' / 'app' / 'src' / 'main' / 'res'

        # Generate icons
        success = generate_icons(
            source_path=source_path,
            output_base=output_base,
            icon_names=['ic_launcher.png', 'ic_launcher_round.png']
        )

        if success:
            print("\nNext Steps:")
            print("   1. Rebuild APK: cd android-app && ./gradlew assembleDebug")
            print("   2. Check APK size reduction")
            print("   3. Test on device: adb install app/build/outputs/apk/debug/app-debug.apk")
            print("   4. Verify icons display correctly")
            return 0
        else:
            return 1

    except FileNotFoundError as e:
        print(f"[ERROR] {e}")
        return 1
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
