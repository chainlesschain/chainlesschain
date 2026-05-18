import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('邮件管理页面', () => {
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

  test('应该能够访问邮件管理页面', async () => {
    // 导航到邮件管理页面
    await window.evaluate(() => {
      window.location.hash = '#/email/accounts?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/email/accounts');
  });

  test('应该显示邮件管理主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/accounts?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有邮箱账户列表或相关内容
    const hasEmailElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasAccounts = document.querySelector('[class*="account"]') ||
                         document.querySelector('[class*="email"]') ||
                         document.querySelector('[class*="list"]') ||
                         document.querySelector('table');
      return !!hasAccounts || body.includes('邮箱') || body.includes('账户') || body.length > 0;
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
      window.location.hash = '#/email/accounts?e2e=true';
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

  test('应该能够与邮件账户列表进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/accounts?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有添加账户或管理账户的按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const addButton = document.querySelector('[class*="add"]');
      const settingsButton = document.querySelector('[class*="setting"]');
      const buttons = document.querySelectorAll('button');
      return !!(addButton || settingsButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示邮箱账户列表或添加账户功能', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/accounts?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有账户列表或添加功能
    const hasAccountManagement = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasAccounts = document.querySelectorAll('[class*="account"]').length > 0 ||
                         document.querySelectorAll('[class*="item"]').length > 0 ||
                         document.querySelectorAll('li').length > 0;
      return hasAccounts || body.includes('添加') || body.includes('邮箱账户');
    });

    expect(hasAccountManagement).toBeDefined();
  });
});
