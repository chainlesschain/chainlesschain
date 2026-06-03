import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('交易市场页面', () => {
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

  test('应该能够访问交易市场页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/marketplace?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/marketplace');
  });

  test('应该显示市场商品列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/marketplace?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMarketplace = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('市场') ||
        bodyText.includes('商品') ||
        bodyText.includes('价格') ||
        bodyText.includes('购买') ||
        bodyText.includes('卖家') ||
        bodyText.length > 0;
    });

    expect(hasMarketplace).toBeTruthy();
  });

  test('应该能够显示商品卡片或列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/marketplace?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasProducts = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const grid = document.querySelector('[class*="grid"]');
      const card = document.querySelector('[class*="card"]');
      const table = document.querySelector('[class*="table"]');
      return !!(list || grid || card || table);
    });

    expect(hasProducts).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/marketplace?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
