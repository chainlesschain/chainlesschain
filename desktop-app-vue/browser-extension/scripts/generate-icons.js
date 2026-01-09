#!/usr/bin/env node

/**
 * Generate PNG icons from SVG for browser extension
 * Requires: sharp (npm install sharp)
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (error) {
  console.error('Error: sharp module not found');
  console.error('Please install it: npm install sharp');
  process.exit(1);
}

const ICON_SIZES = [16, 32, 48, 128];
const SVG_PATH = path.join(__dirname, '../icons/icon.svg');
const OUTPUT_DIR = path.join(__dirname, '../icons');

async function generateIcons() {
  console.log('🎨 Generating PNG icons from SVG...\n');

  // Check if SVG exists
  if (!fs.existsSync(SVG_PATH)) {
    console.error(`❌ SVG file not found: ${SVG_PATH}`);
    process.exit(1);
  }

  // Read SVG content
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Generate each size
  for (const size of ICON_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, `icon${size}.png`);

    try {
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(outputPath);

      console.log(`✅ Generated: icon${size}.png (${size}x${size})`);
    } catch (error) {
      console.error(`❌ Failed to generate icon${size}.png:`, error.message);
    }
  }

  console.log('\n✨ Icon generation complete!');
  console.log('\nGenerated files:');
  ICON_SIZES.forEach(size => {
    const filePath = path.join(OUTPUT_DIR, `icon${size}.png`);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`  - icon${size}.png (${(stats.size / 1024).toFixed(2)} KB)`);
    }
  });
}

// Run
generateIcons().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
