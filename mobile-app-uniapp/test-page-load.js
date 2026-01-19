const puppeteer = require("puppeteer");

(async () => {
  console.log("启动浏览器...");
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // 监听控制台输出
  page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));

  // 监听错误
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message));

  console.log("导航到页面...");
  await page.goto("http://localhost:8080", {
    waitUntil: "networkidle0",
    timeout: 30000,
  });

  console.log("等待内容渲染...");
  await page.waitForTimeout(3000);

  // 截图
  await page.screenshot({ path: "page-screenshot.png" });
  console.log("截图已保存: page-screenshot.png");

  // 获取性能指标
  const performanceMetrics = await page.evaluate(() => {
    const perfData = window.performance.timing;
    const paintEntries = performance.getEntriesByType("paint");

    return {
      domContentLoaded:
        perfData.domContentLoadedEventEnd - perfData.navigationStart,
      loadComplete: perfData.loadEventEnd - perfData.navigationStart,
      firstPaint:
        paintEntries.find((e) => e.name === "first-paint")?.startTime || 0,
      firstContentfulPaint:
        paintEntries.find((e) => e.name === "first-contentful-paint")
          ?.startTime || 0,
    };
  });

  console.log("\n=== 性能指标 ===");
  console.log(`DOM Content Loaded: ${performanceMetrics.domContentLoaded}ms`);
  console.log(`Load Complete: ${performanceMetrics.loadComplete}ms`);
  console.log(`First Paint: ${performanceMetrics.firstPaint}ms`);
  console.log(
    `First Contentful Paint: ${performanceMetrics.firstContentfulPaint}ms`,
  );

  await browser.close();
  console.log("\n测试完成！");
})();
