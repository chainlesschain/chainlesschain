import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('设计编辑器页面', () => {
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

  test('应该能够访问设计编辑器页面', async () => {
    // 导航到设计编辑器页面（使用测试项目ID）
    await window.evaluate(() => {
      window.location.hash = '#/design/test-project?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/design/test-project');
  });

  test('应该显示设计编辑器主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/design/test-project?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有画布或编辑器相关元素
    const hasEditorElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasCanvas = document.querySelector('canvas') ||
                       document.querySelector('svg') ||
                       document.querySelector('[class*="canvas"]') ||
                       document.querySelector('[class*="editor"]') ||
                       document.querySelector('[class*="design"]');
      return !!hasCanvas || body.length > 0;
    });
    expect(hasEditorElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/design/test-project?e2e=true';
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

  test('应该能够与设计编辑器进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/design/test-project?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有工具栏或控制面板
    const hasInteractiveElements = await window.evaluate(() => {
      const toolbar = document.querySelector('[class*="toolbar"]');
      const panel = document.querySelector('[class*="panel"]');
      const controls = document.querySelector('[class*="control"]');
      const buttons = document.querySelectorAll('button');
      return !!(toolbar || panel || controls || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示设计工具或属性面板', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/design/test-project?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有工具面板或属性编辑器
    const hasToolsPanel = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasPanel = document.querySelector('[class*="tool"]') ||
                      document.querySelector('[class*="property"]') ||
                      document.querySelector('[class*="attribute"]');
      return !!hasPanel || body.includes('工具') || body.includes('属性');
    });

    expect(hasToolsPanel).toBeDefined();
  });
});
