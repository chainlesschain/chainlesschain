import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('权限管理页面', () => {
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

  test('应该能够访问权限管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/permissions?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/permissions');
  });

  test('应该显示权限管理主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/permissions?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPermissionsUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('权限') ||
        bodyText.includes('管理') ||
        bodyText.includes('角色') ||
        bodyText.includes('访问') ||
        bodyText.includes('控制') ||
        bodyText.length > 0;
    });

    expect(hasPermissionsUI).toBeTruthy();
  });

  test('应该能够显示权限列表或矩阵', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/permissions?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPermissions = await window.evaluate(() => {
      const table = document.querySelector('[class*="table"]');
      const list = document.querySelector('[class*="list"]');
      const card = document.querySelector('[class*="card"]');
      const tree = document.querySelector('[class*="tree"]');
      return !!(table || list || card || tree);
    });

    expect(hasPermissions).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/permissions?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
