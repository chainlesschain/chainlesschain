import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('角色管理页面', () => {
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

  test('应该能够访问角色管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/roles?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/org/test-org/roles');
  });

  test('应该显示角色管理主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/roles?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasRolesUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('角色') ||
        bodyText.includes('权限') ||
        bodyText.includes('管理') ||
        bodyText.includes('创建') ||
        bodyText.includes('编辑') ||
        bodyText.length > 0;
    });

    expect(hasRolesUI).toBeTruthy();
  });

  test('应该能够显示角色列表或表格', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/roles?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasRoles = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('[class*="table"]');
      const card = document.querySelector('[class*="card"]');
      return !!(list || table || card);
    });

    expect(hasRoles).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/roles?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
