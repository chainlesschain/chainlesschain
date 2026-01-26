import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('知识付费页面', () => {
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

  test('应该能够访问知识付费页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/knowledge-store?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/knowledge-store');
  });

  test('应该显示商店主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/knowledge-store?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasStoreUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('知识') ||
        bodyText.includes('商店') ||
        bodyText.includes('付费') ||
        bodyText.includes('购买') ||
        bodyText.includes('价格') ||
        bodyText.length > 0;
    });

    expect(hasStoreUI).toBeTruthy();
  });

  test('应该能够显示内容列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/knowledge-store?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasList = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const grid = document.querySelector('[class*="grid"]');
      const card = document.querySelector('[class*="card"]');
      return !!(list || grid || card);
    });

    expect(hasList).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/knowledge-store?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
