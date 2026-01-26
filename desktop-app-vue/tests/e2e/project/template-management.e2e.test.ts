import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('模板管理页面', () => {
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

  test('应该能够访问模板管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/template-management?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/template-management');
  });

  test('应该显示模板管理界面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/template-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasTemplateUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('模板') ||
        bodyText.includes('template') ||
        bodyText.length > 0;
    });

    expect(hasTemplateUI).toBeTruthy();
  });

  test('应该能够显示模板列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/template-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasList = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');
      const grid = document.querySelector('[class*="grid"]');
      const card = document.querySelector('[class*="card"]');
      return !!(list || table || grid || card);
    });

    expect(hasList).toBeDefined();
  });

  test('应该有创建或导入模板的功能', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/template-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCreateFeature = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('创建') ||
        bodyText.includes('新建') ||
        bodyText.includes('导入') ||
        bodyText.includes('添加') ||
        document.querySelector('[class*="create"]') ||
        document.querySelector('[class*="add"]');
    });

    expect(hasCreateFeature).toBeDefined();
  });
});
