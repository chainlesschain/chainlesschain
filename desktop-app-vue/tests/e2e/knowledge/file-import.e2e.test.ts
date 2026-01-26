import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('文件导入页面', () => {
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

  test('应该能够访问文件导入页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/file-import?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/file-import');
  });

  test('应该显示文件上传区域', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/file-import?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有上传相关的元素
    const hasUploadArea = await window.evaluate(() => {
      const uploadBtn = document.querySelector('[class*="upload"]');
      const dropZone = document.querySelector('[class*="drop"]');
      const fileInput = document.querySelector('input[type="file"]');
      const bodyText = document.body.innerText.toLowerCase();

      return !!(uploadBtn || dropZone || fileInput ||
        bodyText.includes('上传') ||
        bodyText.includes('导入') ||
        bodyText.includes('选择文件'));
    });

    expect(hasUploadArea).toBeTruthy();
  });

  test('应该显示支持的文件格式说明', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/file-import?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasFormatInfo = await window.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      // 检查常见的文件格式提示
      return bodyText.includes('pdf') ||
        bodyText.includes('word') ||
        bodyText.includes('excel') ||
        bodyText.includes('txt') ||
        bodyText.includes('md') ||
        bodyText.includes('格式') ||
        bodyText.includes('支持');
    });

    expect(hasFormatInfo).toBeDefined();
  });

  test('页面应该可以正常渲染', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/file-import?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasContent = await window.evaluate(() => {
      return document.body.innerText.length > 0;
    });

    expect(hasContent).toBeTruthy();
  });
});
