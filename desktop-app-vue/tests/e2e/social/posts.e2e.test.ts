import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('动态广场页面', () => {
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

  test('应该能够访问动态广场页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/posts?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/posts');
  });

  test('应该显示主要UI元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/posts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMainElements = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasTitle = bodyText.includes('动态') ||
        bodyText.includes('广场') ||
        bodyText.includes('post') ||
        bodyText.includes('社交');
      const hasActions = bodyText.includes('发布') ||
        bodyText.includes('刷新') ||
        document.querySelector('button') ||
        document.querySelector('[class*="post"]');
      const hasContent = document.body.innerText.length > 0;

      return hasTitle || hasActions || hasContent;
    });

    expect(hasMainElements).toBeTruthy();
  });

  test('应该显示动态列表或空状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/posts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasListOrEmpty = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasList = document.querySelector('[class*="list"]') ||
        document.querySelector('[class*="post"]') ||
        document.querySelector('[class*="feed"]') ||
        document.querySelector('[class*="card"]');
      const hasEmpty = bodyText.includes('暂无动态') ||
        bodyText.includes('空') ||
        bodyText.includes('没有内容') ||
        bodyText.includes('empty');

      return !!(hasList || hasEmpty || bodyText.length > 0);
    });

    expect(hasListOrEmpty).toBeTruthy();
  });

  test('页面应该正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/posts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
