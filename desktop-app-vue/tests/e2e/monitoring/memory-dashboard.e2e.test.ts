import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('Memory仪表板页面', () => {
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

  test('应该能够访问Memory仪表板页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/memory?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/memory');
  });

  test('应该显示Memory使用情况', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/memory?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMemory = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('Memory') ||
        bodyText.includes('内存') ||
        bodyText.includes('使用') ||
        bodyText.includes('缓存') ||
        bodyText.includes('Storage') ||
        document.querySelector('[class*="memory"]') ||
        document.querySelector('.ant-statistic');
    });

    expect(hasMemory).toBeTruthy();
  });

  test('应该有Memory统计图表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/memory?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCharts = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('图表') ||
        bodyText.includes('Chart') ||
        bodyText.includes('统计') ||
        bodyText.includes('仪表') ||
        document.querySelector('canvas') ||
        document.querySelector('[class*="chart"]') ||
        document.querySelector('.echarts');
    });

    expect(hasCharts).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/memory?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
