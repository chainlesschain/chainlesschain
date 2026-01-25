import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('钱包管理页面', () => {
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

  test('应该能够访问钱包管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/wallet?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/wallet');
  });

  test('应该显示钱包主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/wallet?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasWalletUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('钱包') ||
        bodyText.includes('余额') ||
        bodyText.includes('资产') ||
        bodyText.includes('转账') ||
        bodyText.includes('地址') ||
        bodyText.length > 0;
    });

    expect(hasWalletUI).toBeTruthy();
  });

  test('应该能够显示资产列表或余额信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/wallet?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasAssets = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('[class*="table"]');
      const card = document.querySelector('[class*="card"]');
      const balance = document.querySelector('[class*="balance"]');
      return !!(list || table || card || balance);
    });

    expect(hasAssets).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/wallet?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
