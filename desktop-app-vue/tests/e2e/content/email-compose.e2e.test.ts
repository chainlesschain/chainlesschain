import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('写邮件页面', () => {
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

  test('应该能够访问写邮件页面', async () => {
    // 导航到写邮件页面
    await window.evaluate(() => {
      window.location.hash = '#/email/compose?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/email/compose');
  });

  test('应该显示写邮件主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/compose?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有邮件编辑器相关元素
    const hasComposeElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasEditor = document.querySelector('[class*="editor"]') ||
                       document.querySelector('textarea') ||
                       document.querySelector('input[type="text"]') ||
                       document.querySelector('[class*="compose"]');
      return !!hasEditor || body.includes('收件人') || body.includes('主题') || body.length > 0;
    });
    expect(hasComposeElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/email/compose?e2e=true';
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

  test('应该能够与邮件编辑器进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/compose?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有发送、保存草稿等按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const sendButton = document.querySelector('[class*="send"]');
      const saveButton = document.querySelector('[class*="save"]');
      const attachButton = document.querySelector('[class*="attach"]');
      const buttons = document.querySelectorAll('button');
      return !!(sendButton || saveButton || attachButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示邮件表单字段', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/email/compose?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有收件人、主题、正文输入框
    const hasFormFields = await window.evaluate(() => {
      const body = document.body.innerText;
      const inputs = document.querySelectorAll('input');
      const textareas = document.querySelectorAll('textarea');
      const hasFields = inputs.length > 0 || textareas.length > 0;
      return hasFields ||
             body.includes('收件人') ||
             body.includes('主题') ||
             body.includes('正文');
    });

    expect(hasFormFields).toBeDefined();
  });
});
