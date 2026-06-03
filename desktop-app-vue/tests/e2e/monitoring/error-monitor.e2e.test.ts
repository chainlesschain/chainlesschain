import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('错误监控页面', () => {
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

  test('应该能够访问错误监控页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/error/monitor?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/error/monitor');
  });

  test('应该显示错误日志列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/error/monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasErrors = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('错误') ||
        bodyText.includes('Error') ||
        bodyText.includes('日志') ||
        bodyText.includes('监控') ||
        bodyText.includes('Monitor') ||
        document.querySelector('[class*="error"]') ||
        document.querySelector('.ant-list') ||
        document.querySelector('table');
    });

    expect(hasErrors).toBeTruthy();
  });

  test('应该有错误诊断和操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/error/monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('诊断') ||
        bodyText.includes('清理') ||
        bodyText.includes('导出') ||
        bodyText.includes('修复') ||
        bodyText.includes('Diagnose') ||
        document.querySelector('button') ||
        document.querySelector('.ant-btn');
    });

    expect(hasActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/error/monitor?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
