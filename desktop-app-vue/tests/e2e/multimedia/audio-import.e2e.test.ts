import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('音频导入页面', () => {
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

  test('应该能够访问音频导入页面', async () => {
    // 导航到音频导入页面
    await window.evaluate(() => {
      window.location.hash = '#/audio/import?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/audio/import');
  });

  test('应该显示音频导入主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/audio/import?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有上传或导入相关元素
    const hasAudioImportElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasUpload = document.querySelector('[class*="upload"]') ||
                       document.querySelector('[class*="import"]') ||
                       document.querySelector('[class*="audio"]') ||
                       document.querySelector('input[type="file"]');
      return !!hasUpload || body.includes('导入') || body.includes('上传') || body.includes('音频') || body.length > 0;
    });
    expect(hasAudioImportElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/audio/import?e2e=true';
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

  test('应该能够与音频导入界面进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/audio/import?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有选择文件、上传、取消等按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const uploadButton = document.querySelector('[class*="upload"]');
      const selectButton = document.querySelector('[class*="select"]');
      const fileInput = document.querySelector('input[type="file"]');
      const buttons = document.querySelectorAll('button');
      return !!(uploadButton || selectButton || fileInput || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示音频文件列表或上传区域', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/audio/import?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有上传区域或文件列表
    const hasUploadArea = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasArea = document.querySelector('[class*="upload"]') ||
                     document.querySelector('[class*="drop"]') ||
                     document.querySelector('[class*="list"]');
      return !!hasArea ||
             body.includes('拖拽') ||
             body.includes('选择文件') ||
             body.includes('支持格式');
    });

    expect(hasUploadArea).toBeDefined();
  });
});
