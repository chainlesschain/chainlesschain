#!/usr/bin/env node

/**
 * 使用 Sharp 进行图片优化
 * 运行前请先安装: npm install sharp --save-dev
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function optimizeImages() {
  console.log("🚀 开始图片优化...\n");

  const tasks = [
    // 小尺寸 PNG - 导航栏
    {
      output: "logo-32.png",
      width: 32,
      height: 32,
      format: "png",
      options: { quality: 90, compressionLevel: 9 },
    },
    // 中等尺寸 PNG - 加载器
    {
      output: "logo-64.png",
      width: 64,
      height: 64,
      format: "png",
      options: { quality: 90, compressionLevel: 9 },
    },
    // 高清 PNG - 备用
    {
      output: "logo-128.png",
      width: 128,
      height: 128,
      format: "png",
      options: { quality: 85, compressionLevel: 9 },
    },
    // WebP - 现代浏览器
    {
      output: "logo.webp",
      width: null, // 保持原尺寸
      format: "webp",
      options: { quality: 80 },
    },
    // 优化后的原尺寸 PNG
    {
      output: "logo-optimized.png",
      width: null,
      format: "png",
      options: { quality: 85, compressionLevel: 9 },
    },
  ];

  for (const task of tasks) {
    try {
      let pipeline = sharp("logo.png");

      if (task.width) {
        pipeline = pipeline.resize(task.width, task.height, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      }

      if (task.format === "webp") {
        await pipeline.webp(task.options).toFile(task.output);
      } else {
        await pipeline.png(task.options).toFile(task.output);
      }

      const stats = fs.statSync(task.output);
      const size = (stats.size / 1024).toFixed(2);
      console.log(`✅ ${task.output}: ${size} KB`);
    } catch (error) {
      console.error(`❌ 优化 ${task.output} 失败:`, error.message);
    }
  }

  console.log("\n🎉 图片优化完成！");
  console.log("\n📊 优化前后对比：");

  const originalSize = fs.statSync("logo.png").size / 1024;
  let optimizedTotal = 0;

  ["logo-32.png", "logo-64.png", "logo-128.png", "logo.webp"].forEach(
    (file) => {
      if (fs.existsSync(file)) {
        optimizedTotal += fs.statSync(file).size / 1024;
      }
    },
  );

  console.log(`   原文件: ${originalSize.toFixed(2)} KB`);
  console.log(`   优化后总计: ${optimizedTotal.toFixed(2)} KB`);
  console.log(
    `   节省: ${((1 - optimizedTotal / originalSize) * 100).toFixed(1)}%`,
  );
}

optimizeImages().catch(console.error);
