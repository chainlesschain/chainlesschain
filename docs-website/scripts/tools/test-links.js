/**
 * 链接有效性检查脚本
 * 用于检查网站中所有链接是否有效
 *
 * 使用方法：node test-links.js
 */

const fs = require("fs");
const path = require("path");

// 配置
const CONFIG = {
  baseDir: __dirname,
  htmlFiles: [
    "index.html",
    "products/enterprise.html",
    "products/project-management.html",
    "products/knowledge-base.html",
    "products/social.html",
    "products/trading.html",
    "technology/technical-docs.html",
    "demo.html",
  ],
  // 需要检查的链接类型
  checkPatterns: {
    internal: /^(#|\/|\.\/|\.\.\/)/, // 内部链接
    external: /^https?:\/\//, // 外部链接
    anchor: /^#/, // 锚点链接
  },
};

// 结果统计
const results = {
  totalLinks: 0,
  internalLinks: [],
  externalLinks: [],
  anchorLinks: [],
  brokenLinks: [],
  warnings: [],
};

/**
 * 提取HTML文件中的所有链接
 */
function extractLinks(htmlContent, filePath) {
  const links = [];

  // 匹配 <a href="...">
  const aTagPattern = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
  let match;

  while ((match = aTagPattern.exec(htmlContent)) !== null) {
    links.push({
      url: match[1],
      type: "a",
      file: filePath,
    });
  }

  // 匹配 <link href="...">
  const linkTagPattern = /<link\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
  while ((match = linkTagPattern.exec(htmlContent)) !== null) {
    links.push({
      url: match[1],
      type: "link",
      file: filePath,
    });
  }

  // 匹配 <script src="...">
  const scriptTagPattern = /<script\s+(?:[^>]*?\s+)?src=["']([^"']+)["']/gi;
  while ((match = scriptTagPattern.exec(htmlContent)) !== null) {
    links.push({
      url: match[1],
      type: "script",
      file: filePath,
    });
  }

  // 匹配 <img src="...">
  const imgTagPattern = /<img\s+(?:[^>]*?\s+)?src=["']([^"']+)["']/gi;
  while ((match = imgTagPattern.exec(htmlContent)) !== null) {
    links.push({
      url: match[1],
      type: "img",
      file: filePath,
    });
  }

  return links;
}

/**
 * 分类链接
 */
function categorizeLink(link) {
  const { url } = link;

  if (CONFIG.checkPatterns.anchor.test(url)) {
    results.anchorLinks.push(link);
  } else if (CONFIG.checkPatterns.external.test(url)) {
    results.externalLinks.push(link);
  } else if (CONFIG.checkPatterns.internal.test(url)) {
    results.internalLinks.push(link);
  } else {
    // 相对路径也算内部链接
    results.internalLinks.push(link);
  }

  results.totalLinks++;
}

/**
 * 检查内部文件是否存在
 */
function checkInternalFile(link) {
  const { url, file } = link;

  // 移除查询参数和锚点
  const filePath = url.split("?")[0].split("#")[0];

  // 跳过锚点链接
  if (filePath === "" || (filePath === url && url.startsWith("#"))) {
    return true;
  }

  // 处理相对路径
  const currentDir = path.dirname(path.join(CONFIG.baseDir, file));
  const fullPath = path.resolve(currentDir, filePath);

  // 检查文件是否存在
  if (!fs.existsSync(fullPath)) {
    results.brokenLinks.push({
      ...link,
      reason: "File not found",
      expectedPath: fullPath,
    });
    return false;
  }

  return true;
}

/**
 * 检查锚点是否存在
 */
function checkAnchor(link) {
  const { url, file } = link;
  const anchor = url.substring(1); // 移除 #

  if (!anchor) return true; // 空锚点表示回到顶部

  // 读取文件内容
  const filePath = path.join(CONFIG.baseDir, file);
  const content = fs.readFileSync(filePath, "utf-8");

  // 检查是否存在对应的 id
  const idPattern = new RegExp(`id=["']${anchor}["']`, "i");

  if (!idPattern.test(content)) {
    results.warnings.push({
      ...link,
      reason: `Anchor #${anchor} not found in ${file}`,
    });
    return false;
  }

  return true;
}

/**
 * 主函数
 */
function main() {
  console.log("🔍 开始检查链接有效性...\n");

  // 1. 遍历所有HTML文件
  CONFIG.htmlFiles.forEach((filePath) => {
    const fullPath = path.join(CONFIG.baseDir, filePath);

    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  文件不存在: ${filePath}`);
      return;
    }

    console.log(`📄 检查文件: ${filePath}`);

    const content = fs.readFileSync(fullPath, "utf-8");
    const links = extractLinks(content, filePath);

    // 分类链接
    links.forEach(categorizeLink);
  });

  console.log("\n📊 链接统计:");
  console.log(`   总链接数: ${results.totalLinks}`);
  console.log(`   内部链接: ${results.internalLinks.length}`);
  console.log(`   外部链接: ${results.externalLinks.length}`);
  console.log(`   锚点链接: ${results.anchorLinks.length}\n`);

  // 2. 检查内部链接
  console.log("🔍 检查内部链接...");
  results.internalLinks.forEach(checkInternalFile);

  // 3. 检查锚点
  console.log("🔍 检查锚点链接...");
  results.anchorLinks.forEach(checkAnchor);

  // 4. 输出结果
  console.log("\n" + "=".repeat(60));
  console.log("📋 检查结果\n");

  if (results.brokenLinks.length === 0) {
    console.log("✅ 所有内部链接都有效！");
  } else {
    console.log(`❌ 发现 ${results.brokenLinks.length} 个失效链接:\n`);
    results.brokenLinks.forEach((link, index) => {
      console.log(`${index + 1}. ${link.file}`);
      console.log(`   链接: ${link.url}`);
      console.log(`   类型: ${link.type}`);
      console.log(`   原因: ${link.reason}`);
      if (link.expectedPath) {
        console.log(`   期望路径: ${link.expectedPath}`);
      }
      console.log("");
    });
  }

  if (results.warnings.length > 0) {
    console.log(`⚠️  发现 ${results.warnings.length} 个警告:\n`);
    results.warnings.forEach((warning, index) => {
      console.log(`${index + 1}. ${warning.file}`);
      console.log(`   ${warning.reason}\n`);
    });
  }

  // 5. 外部链接提示
  if (results.externalLinks.length > 0) {
    console.log("\n💡 提示: 发现以下外部链接（需要手动验证）:\n");

    // 去重
    const uniqueExternalLinks = [
      ...new Set(results.externalLinks.map((l) => l.url)),
    ];
    uniqueExternalLinks.forEach((url, index) => {
      console.log(`${index + 1}. ${url}`);
    });
  }

  console.log("\n" + "=".repeat(60));

  // 6. 生成JSON报告
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalLinks: results.totalLinks,
      internalLinks: results.internalLinks.length,
      externalLinks: results.externalLinks.length,
      anchorLinks: results.anchorLinks.length,
      brokenLinks: results.brokenLinks.length,
      warnings: results.warnings.length,
    },
    brokenLinks: results.brokenLinks,
    warnings: results.warnings,
    externalLinks: [...new Set(results.externalLinks.map((l) => l.url))],
  };

  fs.writeFileSync(
    path.join(CONFIG.baseDir, "link-check-report.json"),
    JSON.stringify(report, null, 2),
  );

  console.log("\n📄 详细报告已保存到: link-check-report.json");

  // 7. 返回退出码
  if (results.brokenLinks.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { extractLinks, checkInternalFile, checkAnchor };
