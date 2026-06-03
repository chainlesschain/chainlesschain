/**
 * iOS App Icon Generator
 * Generates all required iOS app icon sizes from a source image
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Source image path
const SOURCE_IMAGE = path.join(__dirname, "../../assets/logo.png");

// Output directory
const OUTPUT_DIR = path.join(
  __dirname,
  "../ChainlessChain/Resources/Assets.xcassets/AppIcon.appiconset",
);

// iOS App Icon sizes required
const ICON_SIZES = [
  // iPhone
  {
    size: 40,
    name: "Icon-App-20x20@2x.png",
    idiom: "iphone",
    scale: "2x",
    ptSize: "20x20",
  },
  {
    size: 60,
    name: "Icon-App-20x20@3x.png",
    idiom: "iphone",
    scale: "3x",
    ptSize: "20x20",
  },
  {
    size: 58,
    name: "Icon-App-29x29@2x.png",
    idiom: "iphone",
    scale: "2x",
    ptSize: "29x29",
  },
  {
    size: 87,
    name: "Icon-App-29x29@3x.png",
    idiom: "iphone",
    scale: "3x",
    ptSize: "29x29",
  },
  {
    size: 80,
    name: "Icon-App-40x40@2x.png",
    idiom: "iphone",
    scale: "2x",
    ptSize: "40x40",
  },
  {
    size: 120,
    name: "Icon-App-40x40@3x.png",
    idiom: "iphone",
    scale: "3x",
    ptSize: "40x40",
  },
  {
    size: 120,
    name: "Icon-App-60x60@2x.png",
    idiom: "iphone",
    scale: "2x",
    ptSize: "60x60",
  },
  {
    size: 180,
    name: "Icon-App-60x60@3x.png",
    idiom: "iphone",
    scale: "3x",
    ptSize: "60x60",
  },

  // iPad
  {
    size: 20,
    name: "Icon-App-20x20@1x.png",
    idiom: "ipad",
    scale: "1x",
    ptSize: "20x20",
  },
  {
    size: 40,
    name: "Icon-App-20x20@2x-ipad.png",
    idiom: "ipad",
    scale: "2x",
    ptSize: "20x20",
  },
  {
    size: 29,
    name: "Icon-App-29x29@1x.png",
    idiom: "ipad",
    scale: "1x",
    ptSize: "29x29",
  },
  {
    size: 58,
    name: "Icon-App-29x29@2x-ipad.png",
    idiom: "ipad",
    scale: "2x",
    ptSize: "29x29",
  },
  {
    size: 40,
    name: "Icon-App-40x40@1x.png",
    idiom: "ipad",
    scale: "1x",
    ptSize: "40x40",
  },
  {
    size: 80,
    name: "Icon-App-40x40@2x-ipad.png",
    idiom: "ipad",
    scale: "2x",
    ptSize: "40x40",
  },
  {
    size: 76,
    name: "Icon-App-76x76@1x.png",
    idiom: "ipad",
    scale: "1x",
    ptSize: "76x76",
  },
  {
    size: 152,
    name: "Icon-App-76x76@2x.png",
    idiom: "ipad",
    scale: "2x",
    ptSize: "76x76",
  },
  {
    size: 167,
    name: "Icon-App-83.5x83.5@2x.png",
    idiom: "ipad",
    scale: "2x",
    ptSize: "83.5x83.5",
  },

  // App Store
  {
    size: 1024,
    name: "Icon-App-1024x1024@1x.png",
    idiom: "ios-marketing",
    scale: "1x",
    ptSize: "1024x1024",
  },
];

async function generateIcons() {
  console.log("iOS App Icon Generator");
  console.log("======================\n");

  // Check source image exists
  if (!fs.existsSync(SOURCE_IMAGE)) {
    console.error(`Source image not found: ${SOURCE_IMAGE}`);
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Source: ${SOURCE_IMAGE}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  // Generate icons
  const contentsImages = [];

  for (const icon of ICON_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, icon.name);

    try {
      await sharp(SOURCE_IMAGE)
        .resize(icon.size, icon.size, {
          fit: "cover",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .png()
        .toFile(outputPath);

      console.log(`✓ Generated: ${icon.name} (${icon.size}x${icon.size})`);

      // Add to Contents.json images array
      contentsImages.push({
        filename: icon.name,
        idiom: icon.idiom,
        scale: icon.scale,
        size: icon.ptSize,
      });
    } catch (error) {
      console.error(`✗ Failed: ${icon.name} - ${error.message}`);
    }
  }

  // Generate Contents.json
  const contentsJson = {
    images: contentsImages,
    info: {
      author: "xcode",
      version: 1,
    },
  };

  const contentsPath = path.join(OUTPUT_DIR, "Contents.json");
  fs.writeFileSync(contentsPath, JSON.stringify(contentsJson, null, 2));
  console.log(`\n✓ Generated: Contents.json`);

  console.log("\n======================");
  console.log(`Generated ${contentsImages.length} icons successfully!`);
}

generateIcons().catch(console.error);
