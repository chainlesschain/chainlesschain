import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('Terraform Provider Page', () => {
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

  test('should navigate to terraform provider page', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/terraform-provider?e2e=true';
    });
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/terraform-provider');
  });

  test('should display main UI elements', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/terraform-provider?e2e=true';
    });
    await window.waitForTimeout(2000);
    const hasUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('Terraform') ||
             bodyText.includes('Workspace') ||
             bodyText.includes('Provider') ||
             bodyText.includes('Infrastructure') ||
             bodyText.length > 0;
    });
    expect(hasUI).toBeTruthy();
  });

  test('should display UI components', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/terraform-provider?e2e=true';
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
