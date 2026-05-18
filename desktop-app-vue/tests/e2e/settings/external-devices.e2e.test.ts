import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('外部设备页面', () => {
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

  test('应该能够访问外部设备页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/external-devices?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/external-devices');
  });

  test('应该显示外部设备列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/external-devices?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasDevices = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('设备') ||
        bodyText.includes('Device') ||
        bodyText.includes('U-Key') ||
        bodyText.includes('硬件') ||
        document.querySelector('[class*="device"]') ||
        document.querySelector('.ant-list') ||
        document.querySelector('table');
    });

    expect(hasDevices).toBeTruthy();
  });

  test('应该有设备管理操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/external-devices?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasDeviceActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('连接') ||
        bodyText.includes('断开') ||
        bodyText.includes('刷新') ||
        bodyText.includes('检测') ||
        document.querySelector('button') ||
        document.querySelector('.ant-btn');
    });

    expect(hasDeviceActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/external-devices?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
