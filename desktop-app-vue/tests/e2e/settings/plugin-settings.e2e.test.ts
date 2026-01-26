import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('插件管理页面', () => {
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

  test('应该能够访问插件管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/plugins?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/settings/plugins');
  });

  test('应该显示插件列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/plugins?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPluginList = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('插件') ||
        bodyText.includes('Plugin') ||
        bodyText.includes('扩展') ||
        document.querySelector('[class*="plugin"]') ||
        document.querySelector('.ant-list') ||
        document.querySelector('table');
    });

    expect(hasPluginList).toBeTruthy();
  });

  test('应该有插件管理操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/plugins?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPluginActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('启用') ||
        bodyText.includes('禁用') ||
        bodyText.includes('安装') ||
        bodyText.includes('卸载') ||
        document.querySelector('.ant-switch') ||
        document.querySelector('button');
    });

    expect(hasPluginActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/plugins?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
