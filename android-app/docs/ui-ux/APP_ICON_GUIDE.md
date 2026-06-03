# Android App Icon Guide

## Current Status ✅

The ChainlessChain Android app logo has been successfully configured using the project logo from `assets/logo.png`.

### Icon Configuration

| Density | Directory        | Size (Recommended) | Size (Current) | File              |
| ------- | ---------------- | ------------------ | -------------- | ----------------- |
| MDPI    | `mipmap-mdpi`    | 48x48 px           | 270KB          | `ic_launcher.png` |
| HDPI    | `mipmap-hdpi`    | 72x72 px           | 270KB          | `ic_launcher.png` |
| XHDPI   | `mipmap-xhdpi`   | 96x96 px           | 270KB          | `ic_launcher.png` |
| XXHDPI  | `mipmap-xxhdpi`  | 144x144 px         | 270KB          | `ic_launcher.png` |
| XXXHDPI | `mipmap-xxxhdpi` | 192x192 px         | 270KB          | `ic_launcher.png` |

**Round Icon** (for Android 7.1+):

- Same configuration as regular icon
- File: `ic_launcher_round.png`

### AndroidManifest.xml Configuration

```xml
<application
    android:icon="@mipmap/ic_launcher"
    android:roundIcon="@mipmap/ic_launcher_round"
    ...>
```

✅ **Configuration is correct and app will display the logo**

## Optimization Recommendations

### Current Issue

All density directories currently use the same 270KB PNG file. This causes:

- ❌ Larger APK size (~1.35MB just for icons)
- ❌ Wasted memory on lower-density devices
- ❌ Slower app installation

### Recommended: Create Density-Specific Icons

Each density should have appropriately sized icons:

| Density | Dimensions | Target File Size |
| ------- | ---------- | ---------------- |
| MDPI    | 48x48 px   | ~5-10 KB         |
| HDPI    | 72x72 px   | ~10-15 KB        |
| XHDPI   | 96x96 px   | ~15-20 KB        |
| XXHDPI  | 144x144 px | ~25-35 KB        |
| XXXHDPI | 192x192 px | ~40-50 KB        |

**Estimated APK size reduction**: 1.2MB → 150KB (saves ~1MB)

## How to Optimize Icons

### Option 1: Android Studio (Recommended)

1. **Open Android Studio**
2. **Right-click** `android-app/app/src/main/res` → New → Image Asset
3. **Configure Asset Studio**:
   - Asset Type: `Launcher Icons (Adaptive and Legacy)`
   - Name: `ic_launcher`
   - Path: Browse to `assets/logo.png`
   - Trim: `Yes` (if logo has transparent padding)
   - Resize: `100%`
4. **Click Next** → **Finish**
5. Android Studio automatically generates all densities

**Result**: Optimized icons for all densities + adaptive icon support

### Option 2: Online Icon Generator

1. Visit: [Android Asset Studio](https://romannurik.github.io/AndroidAssetStudio/icons-launcher.html)
2. Upload `assets/logo.png`
3. Configure:
   - Shape: None (if logo has shape) or Circle/Square
   - Padding: 0% - 25% (depends on your logo)
   - Background: Transparent or colored
4. Click **Download .zip**
5. Extract and replace files in `android-app/app/src/main/res/mipmap-*`

### Option 3: ImageMagick Script (Command Line)

```bash
# Install ImageMagick first
# Windows: choco install imagemagick
# macOS: brew install imagemagick
# Linux: apt install imagemagick

cd android-app
SOURCE="../assets/logo.png"

# Generate each density
magick "$SOURCE" -resize 48x48 app/src/main/res/mipmap-mdpi/ic_launcher.png
magick "$SOURCE" -resize 72x72 app/src/main/res/mipmap-hdpi/ic_launcher.png
magick "$SOURCE" -resize 96x96 app/src/main/res/mipmap-xhdpi/ic_launcher.png
magick "$SOURCE" -resize 144x144 app/src/main/res/mipmap-xxhdpi/ic_launcher.png
magick "$SOURCE" -resize 192x192 app/src/main/res/mipmap-xxxhdpi/ic_launcher.png

# Same for round icons
magick "$SOURCE" -resize 48x48 app/src/main/res/mipmap-mdpi/ic_launcher_round.png
magick "$SOURCE" -resize 72x72 app/src/main/res/mipmap-hdpi/ic_launcher_round.png
magick "$SOURCE" -resize 96x96 app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
magick "$SOURCE" -resize 144x144 app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
magick "$SOURCE" -resize 192x192 app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png
```

### Option 4: Python Script (Automated)

```python
#!/usr/bin/env python3
# scripts/generate_icons.py

from PIL import Image
import os

DENSITIES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192
}

def generate_icons(source_path, output_base):
    """Generate Android launcher icons for all densities."""
    source = Image.open(source_path)

    for density, size in DENSITIES.items():
        output_dir = os.path.join(output_base, f'mipmap-{density}')
        os.makedirs(output_dir, exist_ok=True)

        # Regular icon
        icon = source.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(output_dir, 'ic_launcher.png'), optimize=True)

        # Round icon
        icon.save(os.path.join(output_dir, 'ic_launcher_round.png'), optimize=True)

        print(f'✓ Generated {density} icons ({size}x{size})')

if __name__ == '__main__':
    source = 'assets/logo.png'
    output = 'android-app/app/src/main/res'
    generate_icons(source, output)
    print('✅ All icons generated successfully!')
```

**Usage**:

```bash
# Install Pillow
pip install Pillow

# Run script
python scripts/generate_icons.py
```

## Adaptive Icons (Android 8.0+)

For modern Android devices, consider creating adaptive icons:

### Benefits

- ✅ Consistent icon shapes across devices
- ✅ Animated effects
- ✅ Better visual quality

### Implementation

1. **Create adaptive icon resources**:

   ```
   android-app/app/src/main/res/
   ├── mipmap-anydpi-v26/
   │   ├── ic_launcher.xml
   │   └── ic_launcher_round.xml
   ├── drawable/
   │   ├── ic_launcher_background.xml
   │   └── ic_launcher_foreground.xml
   ```

2. **ic_launcher.xml** (adaptive icon):

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
       <background android:drawable="@drawable/ic_launcher_background"/>
       <foreground android:drawable="@drawable/ic_launcher_foreground"/>
   </adaptive-icon>
   ```

3. **Use Android Studio** → New → Image Asset → Icon Type: **Adaptive and Legacy**

## Verification

### Check Icon in Emulator/Device

1. **Build APK**:

   ```bash
   cd android-app
   ./gradlew assembleDebug
   ```

2. **Install on device**:

   ```bash
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```

3. **Check app drawer**: Look for ChainlessChain icon

### Check APK Size

```bash
cd android-app
./gradlew assembleRelease

# Before optimization
ls -lh app/build/outputs/apk/release/app-release.apk

# After optimization (should be ~1MB smaller)
ls -lh app/build/outputs/apk/release/app-release.apk
```

### Analyze APK Contents

```bash
# Extract APK
unzip -l app/build/outputs/apk/release/app-release.apk | grep mipmap

# View icon sizes
unzip -l app/build/outputs/apk/release/app-release.apk | grep ic_launcher
```

## Current Files

```
android-app/app/src/main/res/
├── mipmap-mdpi/
│   ├── ic_launcher.png (270KB - ⚠️ should be ~5KB)
│   └── ic_launcher_round.png (270KB - ⚠️ should be ~5KB)
├── mipmap-hdpi/
│   ├── ic_launcher.png (270KB - ⚠️ should be ~10KB)
│   └── ic_launcher_round.png (270KB - ⚠️ should be ~10KB)
├── mipmap-xhdpi/
│   ├── ic_launcher.png (270KB - ⚠️ should be ~15KB)
│   └── ic_launcher_round.png (270KB - ⚠️ should be ~15KB)
├── mipmap-xxhdpi/
│   ├── ic_launcher.png (270KB - ⚠️ should be ~25KB)
│   └── ic_launcher_round.png (270KB - ⚠️ should be ~25KB)
└── mipmap-xxxhdpi/
    ├── ic_launcher.png (270KB - ⚠️ should be ~40KB)
    └── ic_launcher_round.png (270KB - ⚠️ should be ~40KB)
```

**Total current size**: ~2.7MB (10 files × 270KB)
**Target size**: ~150KB (after optimization)
**Savings**: ~2.5MB

## Best Practices

### Icon Design Guidelines

1. **Size**: Source should be at least 512x512 px (1024x1024 for high quality)
2. **Format**: PNG with transparency
3. **Content**:
   - Safe zone: 66% of canvas (icon content)
   - Padding: 17% on each side
4. **Colors**: Use brand colors, avoid gradients on small sizes
5. **Details**: Avoid fine details that disappear at small sizes

### Testing Checklist

- [ ] Icon displays correctly in app drawer
- [ ] Icon displays correctly in settings
- [ ] Icon displays correctly in recent apps
- [ ] Icon looks good on light and dark backgrounds
- [ ] All densities load appropriate sizes
- [ ] APK size is optimized
- [ ] Round icon displays on supported devices

## Troubleshooting

### Icon not updating after rebuild

```bash
# Clear build cache
cd android-app
./gradlew clean

# Reinstall app
adb uninstall com.chainlesschain.android
./gradlew installDebug
```

### Icon appears blurry

**Cause**: Wrong density or upscaling from low-res source

**Fix**: Generate proper density-specific icons (see options above)

### APK size too large

**Cause**: All densities using same 270KB file

**Fix**: Run one of the optimization options above

### Round icon not showing

**Cause**: Device doesn't support round icons (< Android 7.1)

**Fix**: This is normal. Devices without support will use regular icon.

## References

- [Android Icon Design Guidelines](https://developer.android.com/guide/practices/ui_guidelines/icon_design_launcher)
- [Android Asset Studio](https://romannurik.github.io/AndroidAssetStudio/)
- [Material Design Icons](https://material.io/design/iconography/product-icons.html)
- [Adaptive Icons](https://developer.android.com/guide/practices/ui_guidelines/icon_design_adaptive)

## Next Steps

1. ✅ **Current**: Logo configured and working
2. ⏭️ **Recommended**: Optimize icon sizes (save ~2.5MB)
3. ⏭️ **Optional**: Create adaptive icons for Android 8.0+

**Priority**: Medium (app works, but optimization reduces APK size significantly)

---

**Last Updated**: 2024-01-19
**Status**: ✅ Functional (⚠️ Optimization Recommended)
**Maintainer**: ChainlessChain Team
