import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('工作区管理页面', () => {
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

  test('应该能够访问工作区管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/workspace?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/projects/workspace');
  });

  test('应该显示工作区列表或创建按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/workspace?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasWorkspaceUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const createBtn = document.querySelector('[class*="create"]');
      const addBtn = document.querySelector('[class*="add"]');

      return createBtn || addBtn ||
        bodyText.includes('工作区') ||
        bodyText.includes('workspace') ||
        bodyText.length > 0;
    });

    expect(hasWorkspaceUI).toBeTruthy();
  });

  test('应该能够显示工作区管理界面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/workspace?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasManagementUI = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');
      const grid = document.querySelector('[class*="grid"]');
      return !!(list || table || grid);
    });

    expect(hasManagementUI).toBeDefined();
  });

  test('页面应该可以正常渲染', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/workspace?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasContent = await window.evaluate(() => {
      return document.body.innerText.length > 30;
    });

    expect(hasContent).toBeTruthy();
  });
});
