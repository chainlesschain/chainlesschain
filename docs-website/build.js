/**
 * ChainlessChain 官网打包脚本
 *
 * 功能：
 * - 复制所有必要文件到 dist 目录
 * - 压缩静态资源
 * - 生成部署包
 *
 * 使用：node build.js
 */

const fs = require("fs");
const path = require("path");

// 颜色输出
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 配置
const config = {
  sourceDir: __dirname,
  distDir: path.join(__dirname, "dist"),

  // 需要复制的文件和目录
  include: [
    "index.html",
    "css/**/*",
    "js/**/*",
    "images/**/*",
    "products/**/*",
    "technology/**/*",
    "logo.png",
    "logo.svg",
    "favicon.ico",
    "mobile-optimize.css",
  ],

  // 排除的文件
  exclude: [
    "node_modules",
    "dist",
    ".git",
    "*.md",
    "*.bat",
    "*.sh",
    "build.js",
    "package.json",
    "package-lock.json",
    "*.txt",
    "PREVIEW_*",
  ],
};

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 复制文件
function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// 递归复制目录
function copyDir(src, dest) {
  ensureDir(dest);

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // 检查是否应该排除
    if (config.exclude.some((pattern) => entry.name.includes(pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

// 清理 dist 目录
function cleanDist() {
  if (fs.existsSync(config.distDir)) {
    log("🗑️  清理旧的构建文件...", "yellow");
    fs.rmSync(config.distDir, { recursive: true, force: true });
  }
}

// 构建
function build() {
  log(
    "\n╔════════════════════════════════════════════════════════════╗",
    "blue",
  );
  log("║      ChainlessChain 官网打包工具 v1.0.0               ║", "blue");
  log(
    "╚════════════════════════════════════════════════════════════╝\n",
    "blue",
  );

  // 清理
  cleanDist();

  // 创建 dist 目录
  log("📁 创建构建目录...", "blue");
  ensureDir(config.distDir);

  // 复制文件
  log("📦 复制文件到 dist...", "blue");

  const filesToCopy = [
    "index.html",
    "logo.png",
    "logo.svg",
    "mobile-optimize.css",
  ];

  let fileCount = 0;

  // 复制单个文件
  for (const file of filesToCopy) {
    const src = path.join(config.sourceDir, file);
    if (fs.existsSync(src)) {
      const dest = path.join(config.distDir, file);
      copyFile(src, dest);
      log(`  ✓ ${file}`, "green");
      fileCount++;
    }
  }

  // 复制目录
  const dirsToCopy = ["css", "js", "images", "products", "technology"];

  for (const dir of dirsToCopy) {
    const src = path.join(config.sourceDir, dir);
    if (fs.existsSync(src)) {
      const dest = path.join(config.distDir, dir);
      copyDir(src, dest);
      const count = countFiles(dest);
      log(`  ✓ ${dir}/ (${count} 文件)`, "green");
      fileCount += count;
    }
  }

  // 检查 favicon.ico
  const faviconSrc = path.join(config.sourceDir, "favicon.ico");
  if (fs.existsSync(faviconSrc)) {
    copyFile(faviconSrc, path.join(config.distDir, "favicon.ico"));
    log(`  ✓ favicon.ico`, "green");
    fileCount++;
  }

  // 创建部署说明文件
  createDeployReadme();

  // 统计信息
  const distSize = getDirectorySize(config.distDir);

  log("\n" + "━".repeat(60), "blue");
  log("✅ 构建完成！", "bright");
  log("━".repeat(60), "blue");
  log(`📊 统计信息:`, "blue");
  log(`   - 文件总数: ${fileCount}`, "green");
  log(`   - 总大小: ${formatSize(distSize)}`, "green");
  log(`   - 输出目录: ${config.distDir}`, "green");
  log("━".repeat(60) + "\n", "blue");

  log("📝 下一步:", "yellow");
  log("   1. 查看 dist/DEPLOY.txt 了解部署方式", "yellow");
  log("   2. 运行 deploy-to-server.bat 部署到服务器", "yellow");
  log("   3. 或手动上传 dist 目录到服务器\n", "yellow");
}

// 统计文件数量
function countFiles(dir) {
  let count = 0;

  if (!fs.existsSync(dir)) return 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }

  return count;
}

// 计算目录大小
function getDirectorySize(dir) {
  let size = 0;

  if (!fs.existsSync(dir)) return 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirectorySize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }

  return size;
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// 创建部署说明
function createDeployReadme() {
  const content = `ChainlessChain 官网部署包 v1.0.0
================================

📦 构建时间: ${new Date().toLocaleString("zh-CN")}

部署方式
--------

方式1: GitHub Pages
  1. 将 dist 目录内容推送到 gh-pages 分支
  2. 在 GitHub 仓库设置中启用 GitHub Pages
  3. 访问 https://yourusername.github.io/chainlesschain

方式2: 服务器部署
  1. 上传 dist 目录到服务器: /var/www/chainlesschain.com/
  2. 配置 Nginx 或 Apache 指向该目录
  3. 访问你的域名

方式3: Netlify/Vercel
  1. 登录 Netlify 或 Vercel
  2. 拖拽 dist 目录到部署页面
  3. 等待自动部署完成

方式4: 云存储（OSS/COS/S3）
  1. 上传 dist 目录到云存储
  2. 配置静态网站托管
  3. 绑定自定义域名

文件清单
--------
✓ index.html - 主页
✓ generate-qr-code.html - 二维码生成器
✓ css/ - 样式文件
✓ js/ - JavaScript 文件
✓ images/ - 图片资源
✓ products/ - 产品页面
✓ technology/ - 技术文档页面

重要提示
--------
- 确保服务器支持 HTTPS
- 配置 404 页面重定向到 index.html（如需要）
- 设置正确的 MIME 类型
- 启用 Gzip 压缩

技术支持
--------
📞 客服热线: 400-1068-687
💬 企业微信: https://work.weixin.qq.com/ca/cawcde653996f7ecb2
📧 商务邮箱: zhanglongfa@chainlesschain.com
`;

  fs.writeFileSync(path.join(config.distDir, "DEPLOY.txt"), content, "utf-8");
  log(`  ✓ DEPLOY.txt (部署说明)`, "green");
}

// 运行构建
try {
  build();
} catch (error) {
  log(`\n❌ 构建失败: ${error.message}`, "red");
  console.error(error);
  process.exit(1);
}
