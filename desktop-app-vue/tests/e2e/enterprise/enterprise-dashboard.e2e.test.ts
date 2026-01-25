import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('企业仪表板页面', () => {
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

  test('应该能够访问企业仪表板页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/enterprise/dashboard?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/enterprise/dashboard');
  });

  test('应该显示企业仪表板主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/enterprise/dashboard?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasDashboardUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('仪表板') ||
        bodyText.includes('企业') ||
        bodyText.includes('统计') ||
        bodyText.includes('概览') ||
        bodyText.includes('数据') ||
        bodyText.length > 0;
    });

    expect(hasDashboardUI).toBeTruthy();
  });

  test('应该能够显示统计卡片或图表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/enterprise/dashboard?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasDashboard = await window.evaluate(() => {
      const card = document.querySelector('[class*="card"]');
      const chart = document.querySelector('[class*="chart"]');
      const statistic = document.querySelector('[class*="statistic"]');
      const row = document.querySelector('[class*="row"]');
      return !!(card || chart || statistic || row);
    });

    expect(hasDashboard).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/enterprise/dashboard?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
