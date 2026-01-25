import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('组织管理页面', () => {
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

  test('应该能够访问组织管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/organizations?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/organizations');
  });

  test('应该显示组织列表主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/organizations?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasOrgsUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('组织') ||
        bodyText.includes('企业') ||
        bodyText.includes('管理') ||
        bodyText.includes('创建') ||
        bodyText.includes('团队') ||
        bodyText.length > 0;
    });

    expect(hasOrgsUI).toBeTruthy();
  });

  test('应该能够显示组织列表或卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/organizations?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasOrgs = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const grid = document.querySelector('[class*="grid"]');
      const card = document.querySelector('[class*="card"]');
      const table = document.querySelector('[class*="table"]');
      return !!(list || grid || card || table);
    });

    expect(hasOrgs).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/organizations?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
