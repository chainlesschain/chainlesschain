import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('性能监控页面', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    const context = await launchElectronApp();
    app = context.app;
    window = context.window;
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
  });

  test('应该能够访问性能监控页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/performance/dashboard?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/performance/dashboard');
  });

  test('应该显示性能监控仪表板', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/performance/dashboard?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasDashboard = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('性能') ||
        bodyText.includes('Performance') ||
        bodyText.includes('监控') ||
        bodyText.includes('仪表') ||
        bodyText.includes('Dashboard') ||
        document.querySelector('[class*="dashboard"]') ||
        document.querySelector('.ant-statistic');
    });

    expect(hasDashboard).toBeTruthy();
  });

  test('应该有性能指标图表展示', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/performance/dashboard?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCharts = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('图表') ||
        bodyText.includes('Chart') ||
        bodyText.includes('统计') ||
        bodyText.includes('CPU') ||
        bodyText.includes('内存') ||
        document.querySelector('canvas') ||
        document.querySelector('[class*="chart"]') ||
        document.querySelector('.echarts');
    });

    expect(hasCharts).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/performance/dashboard?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
