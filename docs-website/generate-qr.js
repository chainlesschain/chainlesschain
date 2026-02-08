#!/usr/bin/env node

/**
 * 二维码生成脚本
 * 替代在线 API，预生成二维码图片
 */

const fs = require("fs");
const path = require("path");

console.log("📱 二维码生成工具");
console.log("================\n");

console.log("当前使用：api.qrserver.com 在线 API");
console.log("问题：");
console.log("  ✗ 依赖外部服务");
console.log("  ✗ 移动网络加载慢");
console.log("  ✗ API 可能不稳定\n");

console.log("💡 解决方案：");
console.log("  1. 安装 qrcode 库: npm install qrcode --save-dev");
console.log("  2. 预生成二维码图片");
console.log("  3. 保存到 images/qr/ 目录\n");

// 检查是否安装了 qrcode
try {
  const QRCode = require("qrcode");

  console.log("✅ qrcode 已安装，开始生成二维码...\n");

  // 确保目录存在
  const qrDir = path.join(__dirname, "images", "qr");
  if (!fs.existsSync(qrDir)) {
    fs.mkdirSync(qrDir, { recursive: true });
  }

  // 企业微信二维码
  const weworkUrl = "https://work.weixin.qq.com/ca/cawcde653996f7ecb2";
  const outputPath = path.join(qrDir, "wework-contact.png");

  QRCode.toFile(
    outputPath,
    weworkUrl,
    {
      width: 200,
      margin: 1,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    },
    function (err) {
      if (err) {
        console.error("❌ 生成失败:", err);
        return;
      }

      const stats = fs.statSync(outputPath);
      console.log(`✅ 已生成: ${outputPath}`);
      console.log(`   大小: ${(stats.size / 1024).toFixed(2)} KB\n`);

      console.log("🎉 完成！接下来：");
      console.log("   1. 更新 index.html");
      console.log("   2. 将 API URL 替换为: images/qr/wework-contact.png\n");
    },
  );
} catch (e) {
  console.log("⚠️  qrcode 未安装\n");
  console.log("📦 安装命令：");
  console.log("   npm install qrcode --save-dev\n");
  console.log("   然后重新运行: node generate-qr.js\n");

  console.log("或者手动生成：");
  console.log(
    "   1. 访问 https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://work.weixin.qq.com/ca/cawcde653996f7ecb2",
  );
  console.log("   2. 下载图片");
  console.log("   3. 保存到 images/qr/wework-contact.png\n");
}
