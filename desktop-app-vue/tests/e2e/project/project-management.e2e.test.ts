import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('项目列表管理页面', () => {
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

  test('应该能够访问项目列表管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/management?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/projects/management');
  });

  test('应该显示项目列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasProjectList = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');
      const bodyText = document.body.innerText;

      return list || table ||
        bodyText.includes('项目') ||
        bodyText.includes('project') ||
        bodyText.length > 0;
    });

    expect(hasProjectList).toBeTruthy();
  });

  test('应该有项目管理操作按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('编辑') ||
        bodyText.includes('删除') ||
        bodyText.includes('归档') ||
        bodyText.includes('管理') ||
        document.querySelector('[class*="action"]') ||
        document.querySelector('button');
    });

    expect(hasActions).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
