#!/usr/bin/env node

/**
 * 创建扩展图标占位符
 * 使用 Canvas 生成简单的 PNG 图标
 */

const fs = require('fs');
const path = require('path');

// 检查是否有 canvas 库
let Canvas;
try {
  Canvas = require('canvas');
} catch (error) {
  console.log('⚠ canvas 库未安装，将创建占位 README');
  createReadme();
  process.exit(0);
}

const { createCanvas } = Canvas;

const ICONS_DIR = path.join(__dirname, '..', 'browser-extension', 'icons');
const BRAND_COLOR = '#1890ff';
const TEXT_COLOR = '#ffffff';

/**
 * 创建图标
 */
function createIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 背景
  ctx.fillStyle = BRAND_COLOR;
  ctx.fillRect(0, 0, size, size);

  // 圆角矩形背景
  const radius = size * 0.15;
  ctx.clearRect(0, 0, size, size);
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
  ctx.fillStyle = BRAND_COLOR;
  ctx.fill();

  // 文字 "CC"
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `bold ${size * 0.4}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CC', size / 2, size / 2);

  return canvas;
}

/**
 * 保存图标
 */
function saveIcon(size, filename) {
  try {
    const canvas = createIcon(size);
    const buffer = canvas.toBuffer('image/png');
    const filepath = path.join(ICONS_DIR, filename);

    fs.writeFileSync(filepath, buffer);
    console.log(`✓ 创建图标: ${filename} (${size}x${size})`);
  } catch (error) {
    console.error(`✗ 创建图标失败: ${filename}`, error.message);
  }
}

/**
 * 创建 README
 */
function createReadme() {
  const readmePath = path.join(ICONS_DIR, 'README.md');
  if (!fs.existsSync(readmePath)) {
    // README 内容已经在前面创建过了
    console.log('✓ README 已存在');
  }
}

/**
 * 主函数
 */
function main() {
  console.log('='.repeat(60));
  console.log('ChainlessChain 扩展图标生成器');
  console.log('='.repeat(60));
  console.log();

  // 确保目录存在
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  // 生成各种尺寸的图标
  saveIcon(16, 'icon16.png');
  saveIcon(48, 'icon48.png');
  saveIcon(128, 'icon128.png');

  console.log();
  console.log('✓ 所有图标已生成！');
  console.log();
  console.log('图标位置:', ICONS_DIR);
  console.log();
  console.log('注意: 这些是占位图标，建议使用专业设计软件创建正式图标。');
}

// 运行
main();
