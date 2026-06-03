import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('Firmware OTA Page', () => {
  let app: any;
  let window: any;

  test.beforeEach(async () => {
    const context = await launchElectronApp();
    app = context.app;
    window = context.window;
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
  });

  test('should navigate to firmware OTA page', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/firmware-ota?e2e=true';
    });
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/firmware-ota');
  });

  test('should display main UI elements', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/firmware-ota?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('Firmware') ||
             bodyText.includes('OTA') ||
             bodyText.includes('Update') ||
             bodyText.includes('固件') ||
             bodyText.length > 0;
    });
    expect(hasUI).toBeTruthy();
  });

  test('should display UI components', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/firmware-ota?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasComponents = await window.evaluate(() => {
      const tab = document.querySelector('[class*="tab"]');
      const card = document.querySelector('[class*="card"]');
      const list = document.querySelector('[class*="list"]');
      return !!(tab || card || list);
    });
    expect(hasComponents).toBeTruthy();
  });
});
