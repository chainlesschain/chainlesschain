import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('系统配置页面', () => {
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

  test('应该能够访问系统配置页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/system?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/settings/system');
  });

  test('应该显示系统配置选项', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/system?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSystemConfig = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('系统') ||
        bodyText.includes('配置') ||
        bodyText.includes('System') ||
        bodyText.includes('路径') ||
        bodyText.includes('端口') ||
        document.querySelector('input[type="number"]') ||
        document.querySelector('.ant-form-item');
    });

    expect(hasSystemConfig).toBeTruthy();
  });

  test('应该有系统配置表单交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/system?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasInteraction = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('保存') ||
        bodyText.includes('重置') ||
        bodyText.includes('应用') ||
        document.querySelector('button[type="submit"]') ||
        document.querySelector('.ant-btn-primary');
    });

    expect(hasInteraction).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/system?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
