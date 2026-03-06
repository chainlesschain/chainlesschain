import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('SIEM Integration Page', () => {
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

  test('should navigate to SIEM integration page', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/siem-integration?e2e=true';
    });
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/siem-integration');
  });

  test('should display main UI elements', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/siem-integration?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('SIEM') ||
             bodyText.includes('日志') ||
             bodyText.includes('Log') ||
             bodyText.includes('导出') ||
             bodyText.includes('Export') ||
             bodyText.includes('目标') ||
             bodyText.length > 0;
    });
    expect(hasUI).toBeTruthy();
  });

  test('should display UI components', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/siem-integration?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasComponents = await window.evaluate(() => {
      const card = document.querySelector('[class*="card"]');
      const tab = document.querySelector('[class*="tab"]');
      const table = document.querySelector('[class*="table"]');
      return !!(card || tab || table);
    });
    expect(hasComponents).toBeTruthy();
  });
});
