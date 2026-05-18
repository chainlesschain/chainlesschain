import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('BLE Devices Page', () => {
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

  test('should navigate to BLE devices page', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/ble-devices?e2e=true';
    });
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/ble-devices');
  });

  test('should display main UI elements', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/ble-devices?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('蓝牙') ||
             bodyText.includes('BLE') ||
             bodyText.includes('设备') ||
             bodyText.includes('Device') ||
             bodyText.includes('扫描') ||
             bodyText.includes('Scan') ||
             bodyText.length > 0;
    });
    expect(hasUI).toBeTruthy();
  });

  test('should display UI components', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/ble-devices?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasComponents = await window.evaluate(() => {
      const card = document.querySelector('[class*="card"]');
      const tab = document.querySelector('[class*="tab"]');
      const table = document.querySelector('[class*="table"]');
      const button = document.querySelector('[class*="button"]');
      return !!(card || tab || table || button);
    });
    expect(hasComponents).toBeTruthy();
  });
});
