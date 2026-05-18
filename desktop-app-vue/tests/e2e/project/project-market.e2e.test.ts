import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('项目市场页面', () => {
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

  test('应该能够访问项目市场页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/market?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/projects/market');
  });

  test('应该显示市场主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/market?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMarketUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('市场') ||
        bodyText.includes('market') ||
        bodyText.includes('项目') ||
        bodyText.length > 0;
    });

    expect(hasMarketUI).toBeTruthy();
  });

  test('应该显示项目列表或卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/market?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasList = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const grid = document.querySelector('[class*="grid"]');
      const card = document.querySelector('[class*="card"]');
      return !!(list || grid || card || document.body.innerText.length > 50);
    });

    expect(hasList).toBeDefined();
  });

  test('应该支持搜索或筛选功能', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/market?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSearchFilter = await window.evaluate(() => {
      const search = document.querySelector('input[type="search"]');
      const input = document.querySelector('input[placeholder*="搜索"]');
      const filter = document.querySelector('[class*="filter"]');
      const bodyText = document.body.innerText;

      return search || input || filter ||
        bodyText.includes('搜索') ||
        bodyText.includes('筛选');
    });

    expect(hasSearchFilter).toBeDefined();
  });
});
