/**
 * 手动性能测试脚本
 * 使用 Playwright 获取 H5 版本的性能指标
 */

const { chromium } = require("@playwright/test");

async function testPerformance() {
  console.log("🚀 启动性能测试...\n");

  const browser = await chromium.launch({
    headless: false, // 使用可视化浏览器避免 FCP 问题
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  // 设置本地存储模拟登录状态
  await page.addInitScript(() => {
    localStorage.setItem("isLoggedIn", "true");
  });

  console.log("📊 测试首页性能...");
  const startTime = Date.now();

  await page.goto("http://localhost:5173/", {
    waitUntil: "networkidle",
  });

  const loadTime = Date.now() - startTime;

  // 获取性能指标
  const metrics = await page.evaluate(() => {
    const perfData = window.performance.timing;
    const paintEntries = performance.getEntriesByType("paint");
    const navEntries = performance.getEntriesByType("navigation")[0];

    return {
      // 导航时间
      domContentLoaded:
        perfData.domContentLoadedEventEnd - perfData.navigationStart,
      loadComplete: perfData.loadEventEnd - perfData.navigationStart,
      domInteractive: perfData.domInteractive - perfData.navigationStart,

      // 绘制指标
      firstPaint:
        paintEntries.find((e) => e.name === "first-paint")?.startTime || 0,
      firstContentfulPaint:
        paintEntries.find((e) => e.name === "first-contentful-paint")
          ?.startTime || 0,

      // 资源计时
      dnsLookup: perfData.domainLookupEnd - perfData.domainLookupStart,
      tcpConnect: perfData.connectEnd - perfData.connectStart,
      requestTime: perfData.responseEnd - perfData.requestStart,
      domProcessing: perfData.domComplete - perfData.domLoading,

      // 导航类型
      navigationType: navEntries ? navEntries.type : "unknown",

      // 内存（如果可用）
      memory: performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          }
        : null,
    };
  });

  // 获取资源数量
  const resourceCount = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource");
    const byType = {};

    resources.forEach((r) => {
      const type = r.initiatorType || "other";
      if (!byType[type]) {
        byType[type] = { count: 0, size: 0 };
      }
      byType[type].count++;
      byType[type].size += r.transferSize || 0;
    });

    return {
      total: resources.length,
      byType,
    };
  });

  // 输出结果
  console.log("\n=== 📈 性能测试报告 ===\n");

  console.log("⏱️  页面加载时间");
  console.log(`├─ 总加载时间: ${loadTime}ms`);
  console.log(`├─ DOM Content Loaded: ${metrics.domContentLoaded}ms`);
  console.log(`├─ Load Complete: ${metrics.loadComplete}ms`);
  console.log(`└─ DOM Interactive: ${metrics.domInteractive}ms\n`);

  console.log("🎨 绘制指标");
  console.log(`├─ First Paint: ${metrics.firstPaint.toFixed(2)}ms`);
  console.log(
    `└─ First Contentful Paint: ${metrics.firstContentfulPaint.toFixed(2)}ms\n`,
  );

  console.log("🌐 网络指标");
  console.log(`├─ DNS Lookup: ${metrics.dnsLookup}ms`);
  console.log(`├─ TCP Connect: ${metrics.tcpConnect}ms`);
  console.log(`├─ Request Time: ${metrics.requestTime}ms`);
  console.log(`└─ DOM Processing: ${metrics.domProcessing}ms\n`);

  console.log("📦 资源统计");
  console.log(`总资源数: ${resourceCount.total}`);
  Object.entries(resourceCount.byType).forEach(([type, data]) => {
    const sizeMB = (data.size / 1024 / 1024).toFixed(2);
    console.log(`├─ ${type}: ${data.count} 个, ${sizeMB} MB`);
  });

  if (metrics.memory) {
    const usedMB = (metrics.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
    const totalMB = (metrics.memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
    const limitMB = (metrics.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);

    console.log("\n💾 内存使用");
    console.log(`├─ 已使用: ${usedMB} MB`);
    console.log(`├─ 总分配: ${totalMB} MB`);
    console.log(`├─ 限制: ${limitMB} MB`);
    console.log(
      `└─ 使用率: ${((metrics.memory.usedJSHeapSize / metrics.memory.jsHeapSizeLimit) * 100).toFixed(2)}%\n`,
    );
  }

  // 性能评分
  console.log("⭐ 性能评分");
  const performanceScore = calculateScore(metrics);
  console.log(`总分: ${performanceScore.total}/100`);
  console.log(
    `├─ FCP: ${performanceScore.fcp}/100 ${getEmoji(performanceScore.fcp)}`,
  );
  console.log(
    `├─ 加载速度: ${performanceScore.load}/100 ${getEmoji(performanceScore.load)}`,
  );
  console.log(
    `└─ DOM处理: ${performanceScore.dom}/100 ${getEmoji(performanceScore.dom)}\n`,
  );

  // 保存详细结果到JSON
  const results = {
    timestamp: new Date().toISOString(),
    url: "http://localhost:5173/",
    metrics,
    resourceCount,
    performanceScore,
    loadTime,
  };

  const fs = require("fs");
  fs.writeFileSync(
    "performance-test-results.json",
    JSON.stringify(results, null, 2),
  );

  console.log("💾 详细结果已保存到: performance-test-results.json\n");

  await browser.close();
  console.log("✅ 测试完成！\n");
}

function calculateScore(metrics) {
  // 根据Google Lighthouse标准计算分数

  // FCP评分 (< 1.8s = 100, > 3s = 0)
  const fcpSeconds = metrics.firstContentfulPaint / 1000;
  let fcpScore = 100;
  if (fcpSeconds > 3) fcpScore = 0;
  else if (fcpSeconds > 1.8)
    fcpScore = Math.round(100 - ((fcpSeconds - 1.8) / 1.2) * 100);

  // 加载速度评分 (< 2s = 100, > 5s = 0)
  const loadSeconds = metrics.loadComplete / 1000;
  let loadScore = 100;
  if (loadSeconds > 5) loadScore = 0;
  else if (loadSeconds > 2)
    loadScore = Math.round(100 - ((loadSeconds - 2) / 3) * 100);

  // DOM处理评分 (< 1.5s = 100, > 3s = 0)
  const domSeconds = metrics.domInteractive / 1000;
  let domScore = 100;
  if (domSeconds > 3) domScore = 0;
  else if (domSeconds > 1.5)
    domScore = Math.round(100 - ((domSeconds - 1.5) / 1.5) * 100);

  const total = Math.round((fcpScore + loadScore + domScore) / 3);

  return { total, fcp: fcpScore, load: loadScore, dom: domScore };
}

function getEmoji(score) {
  if (score >= 90) return "🟢";
  if (score >= 75) return "🟡";
  if (score >= 50) return "🟠";
  return "🔴";
}

// 运行测试
testPerformance().catch((error) => {
  console.error("❌ 测试失败:", error);
  process.exit(1);
});
