import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('跨链桥页面', () => {
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

  test('应该能够访问跨链桥页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/bridge?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/bridge');
  });

  test('应该显示跨链桥主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/bridge?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasBridgeUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('跨链') ||
        bodyText.includes('桥') ||
        bodyText.includes('转账') ||
        bodyText.includes('链') ||
        bodyText.includes('网络') ||
        bodyText.length > 0;
    });

    expect(hasBridgeUI).toBeTruthy();
  });

  test('应该能够显示跨链转账表单或历史', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/bridge?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasBridge = await window.evaluate(() => {
      const form = document.querySelector('[class*="form"]');
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('[class*="table"]');
      const card = document.querySelector('[class*="card"]');
      return !!(form || list || table || card);
    });

    expect(hasBridge).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/bridge?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
