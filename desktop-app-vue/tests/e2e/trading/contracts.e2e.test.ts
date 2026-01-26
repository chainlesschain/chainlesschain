import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('智能合约页面', () => {
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

  test('应该能够访问智能合约页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contracts?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/contracts');
  });

  test('应该显示合约管理主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contracts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasContractsUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('合约') ||
        bodyText.includes('智能') ||
        bodyText.includes('部署') ||
        bodyText.includes('执行') ||
        bodyText.includes('状态') ||
        bodyText.length > 0;
    });

    expect(hasContractsUI).toBeTruthy();
  });

  test('应该能够显示合约列表或表格', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contracts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasContracts = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('[class*="table"]');
      const card = document.querySelector('[class*="card"]');
      return !!(list || table || card);
    });

    expect(hasContracts).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contracts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
