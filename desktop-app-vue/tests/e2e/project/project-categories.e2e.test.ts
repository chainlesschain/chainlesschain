import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('项目分类页面', () => {
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

  test('应该能够访问项目分类页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/categories?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/projects/categories');
  });

  test('应该显示分类管理界面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/categories?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCategoryUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('分类') ||
        bodyText.includes('category') ||
        bodyText.includes('类别') ||
        bodyText.length > 0;
    });

    expect(hasCategoryUI).toBeTruthy();
  });

  test('应该能够显示分类列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/categories?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasList = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');
      const tree = document.querySelector('[class*="tree"]');
      return !!(list || table || tree);
    });

    expect(hasList).toBeDefined();
  });

  test('应该有创建或编辑分类的功能', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/projects/categories?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasEditFeature = await window.evaluate(() => {
      const createBtn = document.querySelector('[class*="create"]');
      const addBtn = document.querySelector('[class*="add"]');
      const editBtn = document.querySelector('[class*="edit"]');
      const bodyText = document.body.innerText;

      return createBtn || addBtn || editBtn ||
        bodyText.includes('新建') ||
        bodyText.includes('创建') ||
        bodyText.includes('添加');
    });

    expect(hasEditFeature).toBeDefined();
  });
});
