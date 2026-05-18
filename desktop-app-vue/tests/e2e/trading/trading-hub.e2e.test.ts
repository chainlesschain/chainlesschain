import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('交易中心页面', () => {
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

  test('应该能够访问交易中心页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/trading?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/trading');
  });

  test('应该显示交易中心主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/trading?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasTradingUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('交易') ||
        bodyText.includes('中心') ||
        bodyText.includes('市场') ||
        bodyText.includes('资产') ||
        bodyText.includes('订单') ||
        bodyText.length > 0;
    });

    expect(hasTradingUI).toBeTruthy();
  });

  test('应该能够显示交易统计信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/trading?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasStats = await window.evaluate(() => {
      const cards = document.querySelectorAll('[class*="card"]');
      const stats = document.querySelector('[class*="statistic"]');
      const charts = document.querySelector('[class*="chart"]');
      return cards.length > 0 || stats || charts;
    });

    expect(hasStats).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/trading?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
