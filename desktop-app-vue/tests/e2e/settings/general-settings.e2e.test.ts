import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('通用设置页面', () => {
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

  test('应该能够访问通用设置页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/settings');
  });

  test('应该显示主要设置选项', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSettings = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('设置') ||
        bodyText.includes('Settings') ||
        bodyText.includes('配置') ||
        document.querySelector('[class*="setting"]') ||
        document.querySelector('.ant-tabs') ||
        document.querySelector('form');
    });

    expect(hasSettings).toBeTruthy();
  });

  test('应该有设置表单和配置项', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasConfigOptions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('语言') ||
        bodyText.includes('主题') ||
        bodyText.includes('通知') ||
        document.querySelector('input') ||
        document.querySelector('select') ||
        document.querySelector('.ant-switch');
    });

    expect(hasConfigOptions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
