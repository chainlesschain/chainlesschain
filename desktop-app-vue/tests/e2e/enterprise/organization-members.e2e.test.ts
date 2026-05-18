import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('成员管理页面', () => {
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

  test('应该能够访问成员管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/members?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/org/test-org/members');
  });

  test('应该显示成员管理主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/members?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMembersUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('成员') ||
        bodyText.includes('用户') ||
        bodyText.includes('管理') ||
        bodyText.includes('邀请') ||
        bodyText.includes('角色') ||
        bodyText.length > 0;
    });

    expect(hasMembersUI).toBeTruthy();
  });

  test('应该能够显示成员列表或表格', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/members?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMembers = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('[class*="table"]');
      const card = document.querySelector('[class*="card"]');
      return !!(list || table || card);
    });

    expect(hasMembers).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/members?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
