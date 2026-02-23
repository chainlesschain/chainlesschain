#!/usr/bin/env node

/**
 * 图片优化脚本 - 优化 logo.png 并生成多种格式和尺寸
 *
 * 输出：
 * - logo.svg (已有，1.7KB，最优先使用)
 * - logo-32.png (导航栏小图标)
 * - logo-64.png (加载器中等尺寸)
 * - logo-128.png (高清显示备用)
 * - logo.webp (现代浏览器)
 */

const fs = require("fs");
const path = require("path");

// 项目根目录（scripts/build/ 上两级）
const rootDir = path.resolve(__dirname, "../..");

// 由于没有 Sharp，使用纯 Node.js 方案
// 1. 检查是否可以使用系统的 ImageMagick
// 2. 如果没有，提供手动优化建议

console.log("🎨 ChainlessChain 图片优化工具");
console.log("================================\n");

const logoPath = path.join(rootDir, "logo.png");
const logoSvgPath = path.join(rootDir, "logo.svg");

// 检查文件
if (!fs.existsSync(logoPath)) {
  console.error("❌ 未找到 logo.png");
  process.exit(1);
}

const stats = fs.statSync(logoPath);
const sizeMB = (stats.size / 1024).toFixed(2);

console.log(`📊 当前文件信息：`);
console.log(`   logo.png: ${sizeMB} KB`);

if (fs.existsSync(logoSvgPath)) {
  const svgStats = fs.statSync(logoSvgPath);
  console.log(
    `   logo.svg: ${(svgStats.size / 1024).toFixed(2)} KB ✨ (推荐使用)\n`,
  );
}

console.log("💡 优化建议：");
console.log("   1. 优先使用 logo.svg (仅 1.7KB)");
console.log("   2. 为降级浏览器准备小尺寸 PNG");
console.log("   3. 使用在线工具或本地工具压缩：\n");

console.log("🔧 手动优化方案：");
console.log("   A. 在线工具（推荐）：");
console.log("      - https://tinypng.com/ (PNG压缩)");
console.log("      - https://squoosh.app/ (多格式压缩)");
console.log("      - https://imagecompressor.com/ (批量压缩)\n");

console.log("   B. 本地工具：");
console.log("      npm install sharp --save-dev");
console.log("      然后运行: node optimize-images-sharp.js\n");

console.log("📝 推荐配置：");
console.log("   - logo-32.png: 32×32px, <5KB (导航栏)");
console.log("   - logo-64.png: 64×64px, <10KB (加载器)");
console.log("   - logo-128.png: 128×128px, <20KB (高清备用)");
console.log("   - logo.webp: 原尺寸, <30KB (现代浏览器)\n");

// 创建一个使用 Sharp 的优化脚本
const sharpScript = `#!/usr/bin/env node

/**
 * 使用 Sharp 进行图片优化
 * 运行前请先安装: npm install sharp --save-dev
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function optimizeImages() {
    console.log('🚀 开始图片优化...\\n');

    const tasks = [
        // 小尺寸 PNG - 导航栏
        {
            output: 'logo-32.png',
            width: 32,
            height: 32,
            format: 'png',
            options: { quality: 90, compressionLevel: 9 }
        },
        // 中等尺寸 PNG - 加载器
        {
            output: 'logo-64.png',
            width: 64,
            height: 64,
            format: 'png',
            options: { quality: 90, compressionLevel: 9 }
        },
        // 高清 PNG - 备用
        {
            output: 'logo-128.png',
            width: 128,
            height: 128,
            format: 'png',
            options: { quality: 85, compressionLevel: 9 }
        },
        // WebP - 现代浏览器
        {
            output: 'logo.webp',
            width: null,  // 保持原尺寸
            format: 'webp',
            options: { quality: 80 }
        },
        // 优化后的原尺寸 PNG
        {
            output: 'logo-optimized.png',
            width: null,
            format: 'png',
            options: { quality: 85, compressionLevel: 9 }
        }
    ];

    for (const task of tasks) {
        try {
            let pipeline = sharp('logo.png');

            if (task.width) {
                pipeline = pipeline.resize(task.width, task.height, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                });
            }

            if (task.format === 'webp') {
                await pipeline.webp(task.options).toFile(task.output);
            } else {
                await pipeline.png(task.options).toFile(task.output);
            }

            const stats = fs.statSync(task.output);
            const size = (stats.size / 1024).toFixed(2);
            console.log(\`✅ \${task.output}: \${size} KB\`);

        } catch (error) {
            console.error(\`❌ 优化 \${task.output} 失败:\`, error.message);
        }
    }

    console.log('\\n🎉 图片优化完成！');
    console.log('\\n📊 优化前后对比：');

    const originalSize = fs.statSync('logo.png').size / 1024;
    let optimizedTotal = 0;

    ['logo-32.png', 'logo-64.png', 'logo-128.png', 'logo.webp'].forEach(file => {
        if (fs.existsSync(file)) {
            optimizedTotal += fs.statSync(file).size / 1024;
        }
    });

    console.log(\`   原文件: \${originalSize.toFixed(2)} KB\`);
    console.log(\`   优化后总计: \${optimizedTotal.toFixed(2)} KB\`);
    console.log(\`   节省: \${((1 - optimizedTotal/originalSize) * 100).toFixed(1)}%\`);
}

optimizeImages().catch(console.error);
`;

fs.writeFileSync(
  path.join(rootDir, "scripts", "build", "optimize-images-sharp.js"),
  sharpScript,
);

console.log("✅ 已创建 optimize-images-sharp.js 脚本");
console.log(
  "   运行: npm install sharp --save-dev && node optimize-images-sharp.js\n",
);
