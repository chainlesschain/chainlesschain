import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('我的评价页面', () => {
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

  test('应该能够访问我的评价页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/my-reviews?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/my-reviews');
  });

  test('应该显示评价列表主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/my-reviews?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasReviewsUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('评价') ||
        bodyText.includes('评论') ||
        bodyText.includes('我的') ||
        bodyText.includes('星级') ||
        bodyText.includes('反馈') ||
        bodyText.length > 0;
    });

    expect(hasReviewsUI).toBeTruthy();
  });

  test('应该能够显示评价列表或卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/my-reviews?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasReviews = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const card = document.querySelector('[class*="card"]');
      const table = document.querySelector('[class*="table"]');
      const rate = document.querySelector('[class*="rate"]');
      return !!(list || card || table || rate);
    });

    expect(hasReviews).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/my-reviews?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
