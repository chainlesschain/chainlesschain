/**
 * 生成 tabBar 图标
 * 创建简单的纯色 PNG 图标
 */

const fs = require('fs');
const path = require('path');

// 图标配置
const icons = [
  { name: 'knowledge', emoji: '📚', color: '#7A7E83', activeColor: '#3cc51f' },
  { name: 'chat', emoji: '🤖', color: '#7A7E83', activeColor: '#3cc51f' },
  { name: 'social', emoji: '👥', color: '#7A7E83', activeColor: '#3cc51f' },
  { name: 'trade', emoji: '💰', color: '#7A7E83', activeColor: '#3cc51f' },
  { name: 'settings', emoji: '⚙️', color: '#7A7E83', activeColor: '#3cc51f' }
];

// 创建一个简单的 SVG 图标，然后说明如何转换
const imagesDir = path.join(__dirname, '..', 'static', 'images');

// 确保目录存在
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// 为每个图标创建 SVG 文件
icons.forEach(icon => {
  // 普通状态 SVG
  const svgNormal = `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 81 81">
  <text x="40.5" y="60" font-size="60" text-anchor="middle" fill="${icon.color}">${icon.emoji}</text>
</svg>`;

  // 激活状态 SVG
  const svgActive = `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 81 81">
  <text x="40.5" y="60" font-size="60" text-anchor="middle" fill="${icon.activeColor}">${icon.emoji}</text>
</svg>`;

  // 写入 SVG 文件
  fs.writeFileSync(path.join(imagesDir, `${icon.name}.svg`), svgNormal);
  fs.writeFileSync(path.join(imagesDir, `${icon.name}-active.svg`), svgActive);
});

console.log('✅ SVG 图标已生成');
console.log('\n📝 后续步骤：');
console.log('1. 安装 sharp: npm install --save-dev sharp');
console.log('2. 运行转换: node scripts/convert-svg-to-png.js');
console.log('3. 或者使用在线工具将 SVG 转换为 PNG：');
console.log('   https://cloudconvert.com/svg-to-png');
console.log('   尺寸设置为 81x81 像素\n');
