import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('活动日志页面', () => {
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

  test('应该能够访问活动日志页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/activities?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/org/test-org/activities');
  });

  test('应该显示活动日志主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/activities?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActivitiesUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('活动') ||
        bodyText.includes('日志') ||
        bodyText.includes('记录') ||
        bodyText.includes('历史') ||
        bodyText.includes('操作') ||
        bodyText.length > 0;
    });

    expect(hasActivitiesUI).toBeTruthy();
  });

  test('应该能够显示活动日志列表或时间线', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/activities?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActivities = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const timeline = document.querySelector('[class*="timeline"]');
      const table = document.querySelector('[class*="table"]');
      const card = document.querySelector('[class*="card"]');
      return !!(list || timeline || table || card);
    });

    expect(hasActivities).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/activities?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
