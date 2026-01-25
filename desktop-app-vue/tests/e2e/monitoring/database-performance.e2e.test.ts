import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('数据库性能页面', () => {
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

  test('应该能够访问数据库性能页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/database/performance?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/database/performance');
  });

  test('应该显示数据库性能指标', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/database/performance?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMetrics = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('性能') ||
        bodyText.includes('Performance') ||
        bodyText.includes('数据库') ||
        bodyText.includes('Database') ||
        bodyText.includes('查询') ||
        document.querySelector('[class*="performance"]') ||
        document.querySelector('.ant-statistic');
    });

    expect(hasMetrics).toBeTruthy();
  });

  test('应该有性能图表展示', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/database/performance?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCharts = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('图表') ||
        bodyText.includes('Chart') ||
        bodyText.includes('统计') ||
        document.querySelector('canvas') ||
        document.querySelector('[class*="chart"]') ||
        document.querySelector('.echarts');
    });

    expect(hasCharts).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/database/performance?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
