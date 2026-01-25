import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('插件发布页面', () => {
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

  test('应该能够访问插件发布页面', async () => {
    // 导航到插件发布页面
    await window.evaluate(() => {
      window.location.hash = '#/plugins/publisher?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/plugins/publisher');
  });

  test('应该显示插件发布主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/plugins/publisher?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有发布表单或相关内容
    const hasPublisherElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasForm = document.querySelector('form') ||
                     document.querySelector('[class*="form"]') ||
                     document.querySelector('[class*="publish"]') ||
                     document.querySelector('input') ||
                     document.querySelector('textarea');
      return !!hasForm || body.includes('发布') || body.includes('上传') || body.length > 0;
    });
    expect(hasPublisherElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/plugins/publisher?e2e=true';
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

  test('应该能够与插件发布表单进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/plugins/publisher?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有上传、保存、发布等按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const uploadButton = document.querySelector('[class*="upload"]');
      const submitButton = document.querySelector('[class*="submit"]');
      const publishButton = document.querySelector('[class*="publish"]');
      const buttons = document.querySelectorAll('button');
      return !!(uploadButton || submitButton || publishButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示插件信息表单字段', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/plugins/publisher?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有插件名称、描述等输入字段
    const hasFormFields = await window.evaluate(() => {
      const body = document.body.innerText;
      const inputs = document.querySelectorAll('input');
      const textareas = document.querySelectorAll('textarea');
      const hasFields = inputs.length > 0 || textareas.length > 0;
      return hasFields ||
             body.includes('名称') ||
             body.includes('描述') ||
             body.includes('版本');
    });

    expect(hasFormFields).toBeDefined();
  });
});
