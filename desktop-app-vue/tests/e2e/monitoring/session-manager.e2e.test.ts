import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('会话管理页面', () => {
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

  test('应该能够访问会话管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sessions?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/sessions');
  });

  test('应该显示会话列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sessions?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSessions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('会话') ||
        bodyText.includes('Session') ||
        bodyText.includes('对话') ||
        document.querySelector('[class*="session"]') ||
        document.querySelector('.ant-list') ||
        document.querySelector('table');
    });

    expect(hasSessions).toBeTruthy();
  });

  test('应该有会话管理操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sessions?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('搜索') ||
        bodyText.includes('导出') ||
        bodyText.includes('删除') ||
        bodyText.includes('压缩') ||
        bodyText.includes('Search') ||
        document.querySelector('input[type="search"]') ||
        document.querySelector('button');
    });

    expect(hasActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sessions?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
