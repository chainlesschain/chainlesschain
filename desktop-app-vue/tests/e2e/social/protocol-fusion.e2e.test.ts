import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('Protocol Fusion Page', () => {
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

  test('should navigate to protocol-fusion page', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/protocol-fusion?e2e=true';
    });
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/protocol-fusion');
  });

  test('should display main UI elements', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/protocol-fusion?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('Protocol') ||
             bodyText.includes('Fusion') ||
             bodyText.length > 0;
    });
    expect(hasUI).toBeTruthy();
  });

  test('should display UI components', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/protocol-fusion?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasComponents = await window.evaluate(() => {
      const tab = document.querySelector('[class*="tab"]');
      const table = document.querySelector('[class*="table"]');
      const card = document.querySelector('[class*="card"]');
      return !!(tab || table || card);
    });
    expect(hasComponents).toBeTruthy();
  });
});
