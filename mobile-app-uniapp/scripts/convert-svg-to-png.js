/**
 * 将 SVG 图标转换为 PNG
 * 使用 sharp 库进行转换
 */

const fs = require('fs');
const path = require('path');

try {
  const sharp = require('sharp');

  const imagesDir = path.join(__dirname, '..', 'static', 'images');

  // 获取所有 SVG 文件
  const svgFiles = fs.readdirSync(imagesDir).filter(file => file.endsWith('.svg'));

  console.log(`找到 ${svgFiles.length} 个 SVG 文件，开始转换...\n`);

  // 转换每个 SVG 文件
  const promises = svgFiles.map(async (svgFile) => {
    const svgPath = path.join(imagesDir, svgFile);
    const pngPath = path.join(imagesDir, svgFile.replace('.svg', '.png'));

    try {
      await sharp(svgPath)
        .resize(81, 81)
        .png()
        .toFile(pngPath);

      console.log(`✅ ${svgFile} -> ${path.basename(pngPath)}`);
    } catch (error) {
      console.error(`❌ 转换失败: ${svgFile}`, error.message);
    }
  });

  Promise.all(promises).then(() => {
    console.log('\n🎉 所有图标转换完成！');
  });

} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('❌ 错误: 未找到 sharp 模块');
    console.log('\n请先安装 sharp:');
    console.log('  npm install --save-dev sharp\n');
    console.log('或者手动转换 SVG 文件：');
    console.log('  1. 打开 static/images/ 目录');
    console.log('  2. 使用在线工具转换: https://cloudconvert.com/svg-to-png');
    console.log('  3. 设置尺寸为 81x81 像素\n');
  } else {
    console.error('❌ 错误:', error);
  }
  process.exit(1);
}
