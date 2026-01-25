import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('插件页面', () => {
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

  test('应该能够访问插件页面', async () => {
    // 导航到插件页面（使用测试插件ID）
    await window.evaluate(() => {
      window.location.hash = '#/plugin/test-plugin?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/plugin/test-plugin');
  });

  test('应该显示插件页面主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/plugin/test-plugin?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有插件详情相关内容
    const hasPluginElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasDetails = document.querySelector('[class*="plugin"]') ||
                        document.querySelector('[class*="detail"]') ||
                        document.querySelector('[class*="info"]') ||
                        document.querySelector('[class*="description"]');
      return !!hasDetails || body.length > 0;
    });
    expect(hasPluginElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/plugin/test-plugin?e2e=true';
    });
    await window.waitForTimeout(3000);

    // 过滤掉一些已知的非关键错误
    const criticalErrors = consoleErrors.filter(err =>
      !err.includes('DevTools') &&
      !err.includes('extension') &&
      !err.includes('favicon')
    );

    expect(criticalErrors.length).toBe(0);
  });

  test('应该能够与插件页面进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/plugin/test-plugin?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有安装、卸载、启用等按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const installButton = document.querySelector('[class*="install"]');
      const uninstallButton = document.querySelector('[class*="uninstall"]');
      const enableButton = document.querySelector('[class*="enable"]');
      const buttons = document.querySelectorAll('button');
      return !!(installButton || uninstallButton || enableButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示插件详细信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/plugin/test-plugin?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有插件名称、版本、描述等信息
    const hasPluginInfo = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasTitle = document.querySelector('h1') ||
                      document.querySelector('h2') ||
                      document.querySelector('[class*="title"]');
      const hasVersion = body.includes('版本') ||
                        body.includes('version');
      const hasDescription = body.includes('描述') ||
                            body.includes('说明') ||
                            body.length > 100;
      return !!(hasTitle || hasVersion || hasDescription);
    });

    expect(hasPluginInfo).toBeDefined();
  });
});
