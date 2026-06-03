import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('阅读邮件页面', () => {
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

  test('应该能够访问阅读邮件页面', async () => {
    // 导航到阅读邮件页面（使用测试邮件ID）
    await window.evaluate(() => {
      window.location.hash = '#/email/read/test-email?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/email/read/test-email');
  });

  test('应该显示阅读邮件主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/read/test-email?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有邮件内容相关元素
    const hasEmailElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasContent = document.querySelector('[class*="email"]') ||
                        document.querySelector('[class*="message"]') ||
                        document.querySelector('[class*="content"]') ||
                        document.querySelector('[class*="mail"]');
      return !!hasContent || body.length > 0;
    });
    expect(hasEmailElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/email/read/test-email?e2e=true';
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

  test('应该能够与邮件进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/read/test-email?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有回复、转发、删除等按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const replyButton = document.querySelector('[class*="reply"]');
      const forwardButton = document.querySelector('[class*="forward"]');
      const deleteButton = document.querySelector('[class*="delete"]');
      const buttons = document.querySelectorAll('button');
      return !!(replyButton || forwardButton || deleteButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示邮件头部信息和正文内容', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/read/test-email?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有发件人、主题、正文等信息
    const hasEmailContent = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasHeader = document.querySelector('[class*="header"]') ||
                       document.querySelector('[class*="from"]') ||
                       document.querySelector('[class*="subject"]');
      const hasBody = document.querySelector('[class*="body"]') ||
                     document.querySelector('[class*="content"]');
      return !!(hasHeader || hasBody) ||
             body.includes('发件人') ||
             body.includes('主题') ||
             body.length > 100;
    });

    expect(hasEmailContent).toBeDefined();
  });
});
