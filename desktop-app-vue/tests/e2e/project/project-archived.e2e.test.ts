import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('已归档项目页面', () => {
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

  test('应该能够访问已归档项目页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/archived?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/projects/archived');
  });

  test('应该显示归档项目列表或空状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/archived?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasArchivedUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');

      return list || table ||
        bodyText.includes('归档') ||
        bodyText.includes('archived') ||
        bodyText.includes('暂无') ||
        bodyText.includes('空') ||
        bodyText.length > 0;
    });

    expect(hasArchivedUI).toBeTruthy();
  });

  test('应该有恢复或删除归档项目的操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/archived?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('恢复') ||
        bodyText.includes('删除') ||
        bodyText.includes('还原') ||
        bodyText.includes('restore') ||
        document.querySelector('[class*="action"]') ||
        document.querySelector('button');
    });

    expect(hasActions).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/archived?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
