#!/usr/bin/env node

/**
 * Generate PNG icons from SVG for browser extension
 * Uses canvas module (already in desktop-app-vue dependencies)
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const ICON_SIZES = [16, 32, 48, 128];
const OUTPUT_DIR = path.join(__dirname, '../icons');

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background with rounded corners
  const radius = size * 0.15625; // 20/128 ratio
  ctx.fillStyle = '#1890ff';
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();

  // Text "CC"
  const fontSize = size * 0.4375; // 56/128 ratio
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CC', size / 2, size / 2 + fontSize * 0.1);

  return canvas;
}

async function generateIcons() {
  console.log('🎨 Generating PNG icons...\n');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate each size
  for (const size of ICON_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, `icon${size}.png`);

    try {
      const canvas = generateIcon(size);
      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(outputPath, buffer);

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
