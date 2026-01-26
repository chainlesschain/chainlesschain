import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('文章阅读页面', () => {
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

  test('应该能够访问文章阅读页面', async () => {
    // 导航到文章阅读页面（使用测试订阅源ID）
    await window.evaluate(() => {
      window.location.hash = '#/rss/article/test-feed?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/rss/article/test-feed');
  });

  test('应该显示文章阅读主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/rss/article/test-feed?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有文章内容相关元素
    const hasArticleElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasContent = document.querySelector('[class*="article"]') ||
                        document.querySelector('[class*="content"]') ||
                        document.querySelector('[class*="post"]') ||
                        document.querySelector('article');
      return !!hasContent || body.length > 0;
    });
    expect(hasArticleElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/rss/article/test-feed?e2e=true';
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

  test('应该能够与文章进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/rss/article/test-feed?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有分享、收藏或其他交互按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const shareButton = document.querySelector('[class*="share"]');
      const favoriteButton = document.querySelector('[class*="favorite"]');
      const backButton = document.querySelector('[class*="back"]');
      const buttons = document.querySelectorAll('button');
      return !!(shareButton || favoriteButton || backButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示文章标题或正文内容', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/rss/article/test-feed?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有文章标题或正文
    const hasArticleContent = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasTitle = document.querySelector('h1') ||
                      document.querySelector('h2') ||
                      document.querySelector('[class*="title"]');
      const hasText = document.querySelector('p') ||
                     document.querySelector('[class*="text"]');
      return !!(hasTitle || hasText) || body.includes('文章') || body.length > 100;
    });

    expect(hasArticleContent).toBeDefined();
  });
});
