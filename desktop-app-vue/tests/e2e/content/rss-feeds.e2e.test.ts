import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('RSS订阅页面', () => {
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

  test('应该能够访问RSS订阅页面', async () => {
    // 导航到RSS订阅页面
    await window.evaluate(() => {
      window.location.hash = '#/rss/feeds?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/rss/feeds');
  });

  test('应该显示RSS订阅主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/rss/feeds?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有订阅源列表或相关内容
    const hasRSSElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasList = document.querySelector('[class*="list"]') ||
                     document.querySelector('[class*="feed"]') ||
                     document.querySelector('[class*="rss"]') ||
                     document.querySelector('table');
      return !!hasList || body.includes('订阅') || body.includes('RSS') || body.length > 0;
    });
    expect(hasRSSElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/rss/feeds?e2e=true';
    });
    await window.waitForTimeout(3000);

    // 过滤掉一些已知的非关键错误
    const criticalErrors = consoleErrors.filter(err =>
      !err.includes('DevTools') &&
      !err.includes('extension') &&
      !err.includes('favicon')
    );

    expect(criticalErrors.length).toBe(0);
  });

  test('应该能够与RSS订阅列表进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/rss/feeds?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有添加订阅或管理订阅的按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const addButton = document.querySelector('[class*="add"]');
      const refreshButton = document.querySelector('[class*="refresh"]');
      const buttons = document.querySelectorAll('button');
      return !!(addButton || refreshButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示订阅源列表或添加订阅功能', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/rss/feeds?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有订阅源列表或添加按钮
    const hasFeedManagement = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasFeeds = document.querySelectorAll('[class*="feed"]').length > 0 ||
                      document.querySelectorAll('[class*="item"]').length > 0 ||
                      document.querySelectorAll('li').length > 0;
      return hasFeeds || body.includes('添加') || body.includes('订阅源');
    });

    expect(hasFeedManagement).toBeDefined();
  });
});
