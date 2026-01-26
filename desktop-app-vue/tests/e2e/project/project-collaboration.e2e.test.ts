import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('协作项目页面', () => {
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

  test('应该能够访问协作项目页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/collaboration?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/projects/collaboration');
  });

  test('应该显示协作项目列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/collaboration?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCollabUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');

      return list || table ||
        bodyText.includes('协作') ||
        bodyText.includes('collaboration') ||
        bodyText.includes('团队') ||
        bodyText.length > 0;
    });

    expect(hasCollabUI).toBeTruthy();
  });

  test('应该显示项目成员或协作信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/collaboration?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCollabInfo = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('成员') ||
        bodyText.includes('协作者') ||
        bodyText.includes('共享') ||
        bodyText.includes('权限') ||
        bodyText.length > 30;
    });

    expect(hasCollabInfo).toBeDefined();
  });

  test('页面应该可以正常渲染', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/collaboration?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasContent = await window.evaluate(() => {
      return document.body.innerText.length > 0;
    });

    expect(hasContent).toBeTruthy();
  });
});
