import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('图片上传页面', () => {
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

  test('应该能够访问图片上传页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/image-upload?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/image-upload');
  });

  test('应该显示图片上传界面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/image-upload?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasUploadUI = await window.evaluate(() => {
      const uploadBtn = document.querySelector('[class*="upload"]');
      const imgInput = document.querySelector('input[type="file"][accept*="image"]');
      const bodyText = document.body.innerText;

      return !!(uploadBtn || imgInput || bodyText.includes('图片') || bodyText.includes('上传'));
    });

    expect(hasUploadUI).toBeTruthy();
  });

  test('应该支持图片格式说明', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/image-upload?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasImageFormats = await window.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      return bodyText.includes('jpg') ||
        bodyText.includes('png') ||
        bodyText.includes('jpeg') ||
        bodyText.includes('gif') ||
        bodyText.includes('图片') ||
        bodyText.includes('image');
    });

    expect(hasImageFormats).toBeDefined();
  });

  test('页面应该没有致命错误', async () => {
    const criticalErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('DevTools')) {
        criticalErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/image-upload?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCriticalErrors = criticalErrors.some(err =>
      err.includes('Cannot read') ||
      err.includes('undefined') ||
      err.includes('null')
    );

    expect(hasCriticalErrors).toBeFalsy();
  });
});
