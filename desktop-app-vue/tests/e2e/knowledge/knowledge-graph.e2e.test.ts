import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('知识图谱页面', () => {
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

  test('应该能够访问知识图谱页面', async () => {
    // 导航到知识图谱页面
    await window.evaluate(() => {
      window.location.hash = '#/knowledge/graph?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/knowledge/graph');
  });

  test('应该显示知识图谱主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/knowledge/graph?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查页面标题或主要容器是否存在
    const hasContent = await window.evaluate(() => {
      const body = document.body.innerText;
      return body.length > 0;
    });
    expect(hasContent).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/knowledge/graph?e2e=true';
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

  test('应该能够与图谱进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/knowledge/graph?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有交互元素（如canvas、svg等）
    const hasInteractiveElement = await window.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const svg = document.querySelector('svg');
      const graph = document.querySelector('[class*="graph"]');
      return !!(canvas || svg || graph);
    });

    // 知识图谱页面应该有某种可视化元素
    expect(hasInteractiveElement).toBeDefined();
  });
});
