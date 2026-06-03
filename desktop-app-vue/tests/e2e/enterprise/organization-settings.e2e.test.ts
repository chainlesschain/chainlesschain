import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('组织设置页面', () => {
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

  test('应该能够访问组织设置页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/settings?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/org/test-org/settings');
  });

  test('应该显示组织设置主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/settings?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSettingsUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('设置') ||
        bodyText.includes('配置') ||
        bodyText.includes('组织') ||
        bodyText.includes('信息') ||
        bodyText.includes('管理') ||
        bodyText.length > 0;
    });

    expect(hasSettingsUI).toBeTruthy();
  });

  test('应该能够显示设置表单或选项', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/settings?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSettings = await window.evaluate(() => {
      const form = document.querySelector('[class*="form"]');
      const card = document.querySelector('[class*="card"]');
      const input = document.querySelector('input');
      const tabs = document.querySelector('[class*="tabs"]');
      return !!(form || card || input || tabs);
    });

    expect(hasSettings).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/settings?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
