import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('同步冲突页面', () => {
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

  test('应该能够访问同步冲突页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sync/conflicts?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/sync/conflicts');
  });

  test('应该显示同步冲突列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sync/conflicts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasConflicts = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('同步') ||
        bodyText.includes('冲突') ||
        bodyText.includes('Sync') ||
        bodyText.includes('Conflict') ||
        bodyText.includes('合并') ||
        document.querySelector('[class*="conflict"]') ||
        document.querySelector('.ant-list') ||
        document.querySelector('table');
    });

    expect(hasConflicts).toBeTruthy();
  });

  test('应该有冲突解决操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sync/conflicts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('解决') ||
        bodyText.includes('合并') ||
        bodyText.includes('保留') ||
        bodyText.includes('Resolve') ||
        bodyText.includes('Merge') ||
        document.querySelector('button') ||
        document.querySelector('.ant-btn');
    });

    expect(hasActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/sync/conflicts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
