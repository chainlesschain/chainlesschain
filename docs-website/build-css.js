#!/usr/bin/env node

/**
 * CSS 构建工具 - 合并和压缩 CSS 文件
 *
 * 合并以下文件：
 * - css/style.css (52KB)
 * - loading-animation-v2.css (5.9KB)
 * - loading.css (9.3KB)
 * - mobile-optimize.css (9.4KB)
 *
 * 输出：
 * - dist/main.min.css (压缩版，用于生产)
 * - dist/main.css (未压缩版，用于调试)
 */

const fs = require("fs");
const path = require("path");

console.log("🎨 CSS 构建工具");
console.log("================\n");

// 确保 dist 目录存在
const distDir = path.join(__dirname, "dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
  console.log("✅ 创建 dist 目录");
}

// CSS 文件列表（按加载顺序）
const cssFiles = [
  "css/style.css",
  "loading-animation-v2.css",
  "loading.css",
  "mobile-optimize.css",
];

console.log("📦 合并以下 CSS 文件：");

let combinedCSS = "";
let totalSize = 0;

// 合并所有 CSS
for (const file of cssFiles) {
  const filePath = path.join(__dirname, file);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  文件不存在，跳过: ${file}`);
    continue;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const size = Buffer.byteLength(content, "utf8");
  totalSize += size;

  console.log(`   ✓ ${file} (${(size / 1024).toFixed(2)} KB)`);

  // 添加文件来源注释
  combinedCSS += `\n/* ========================================\n`;
  combinedCSS += `   Source: ${file}\n`;
  combinedCSS += `   ======================================== */\n`;
  combinedCSS += content;
  combinedCSS += "\n\n";
}

console.log(`\n📊 合并前总大小: ${(totalSize / 1024).toFixed(2)} KB\n`);

// 保存未压缩版本
const outputPath = path.join(distDir, "main.css");
fs.writeFileSync(outputPath, combinedCSS);
console.log(
  `✅ 已生成: dist/main.css (${(combinedCSS.length / 1024).toFixed(2)} KB)`,
);

// 简单压缩：移除注释和多余空白
function minifyCSS(css) {
  return (
    css
      // 移除多行注释
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // 移除行首行尾空白
      .replace(/^\s+|\s+$/gm, "")
      // 移除空行
      .replace(/\n+/g, "\n")
      // 压缩空格
      .replace(/\s*([{}:;,>+~])\s*/g, "$1")
      // 移除最后一个分号
      .replace(/;}/g, "}")
      // 压缩颜色值
      .replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3/gi, "#$1$2$3")
      // 移除单位为 0 的值
      .replace(/(\s|:)0(px|em|%|rem|vh|vw|vmin|vmax)/g, "$10")
      // 移除行首行尾空白
      .trim()
  );
}

const minifiedCSS = minifyCSS(combinedCSS);
const minifiedPath = path.join(distDir, "main.min.css");
fs.writeFileSync(minifiedPath, minifiedCSS);

const minifiedSize = Buffer.byteLength(minifiedCSS, "utf8");
const compressionRatio = ((1 - minifiedSize / totalSize) * 100).toFixed(1);

console.log(
  `✅ 已生成: dist/main.min.css (${(minifiedSize / 1024).toFixed(2)} KB)`,
);
console.log(`\n🎉 压缩完成！`);
console.log(`   原始大小: ${(totalSize / 1024).toFixed(2)} KB`);
console.log(`   压缩后: ${(minifiedSize / 1024).toFixed(2)} KB`);
console.log(`   压缩率: ${compressionRatio}%\n`);

console.log("💡 下一步：");
console.log("   1. 更新 index.html 中的 CSS 引用");
console.log("   2. 删除或注释掉旧的多个 <link> 标签");
console.log(
  '   3. 添加单个引用: <link rel="stylesheet" href="dist/main.min.css">\n',
);
