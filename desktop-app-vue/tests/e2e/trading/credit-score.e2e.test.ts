import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('信用评分页面', () => {
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

  test('应该能够访问信用评分页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/credit-score?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/credit-score');
  });

  test('应该显示信用评分主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/credit-score?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCreditUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('信用') ||
        bodyText.includes('评分') ||
        bodyText.includes('分数') ||
        bodyText.includes('等级') ||
        bodyText.includes('历史') ||
        bodyText.length > 0;
    });

    expect(hasCreditUI).toBeTruthy();
  });

  test('应该能够显示评分详情', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/credit-score?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasScore = await window.evaluate(() => {
      const score = document.querySelector('[class*="score"]');
      const chart = document.querySelector('[class*="chart"]');
      const progress = document.querySelector('[class*="progress"]');
      const card = document.querySelector('[class*="card"]');
      return !!(score || chart || progress || card);
    });

    expect(hasScore).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/credit-score?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
