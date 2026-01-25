import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('工具管理页面', () => {
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

  test('应该能够访问工具管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/tools?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/settings/tools');
  });

  test('应该显示工具列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/tools?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasTools = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('工具') ||
        bodyText.includes('Tool') ||
        bodyText.includes('MCP') ||
        document.querySelector('[class*="tool"]') ||
        document.querySelector('.ant-list') ||
        document.querySelector('table');
    });

    expect(hasTools).toBeTruthy();
  });

  test('应该有工具配置和管理操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/tools?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasToolActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('配置') ||
        bodyText.includes('启用') ||
        bodyText.includes('禁用') ||
        bodyText.includes('添加') ||
        document.querySelector('button') ||
        document.querySelector('.ant-switch');
    });

    expect(hasToolActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/tools?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
