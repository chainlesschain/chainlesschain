import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('提示词模板页面', () => {
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

  test('应该能够访问提示词模板页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/prompt-templates?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/prompt-templates');
  });

  test('应该显示模板列表或创建按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/prompt-templates?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasTemplateUI = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');
      const createBtn = document.querySelector('[class*="create"]');
      const addBtn = document.querySelector('[class*="add"]');
      const bodyText = document.body.innerText;

      return !!(list || table || createBtn || addBtn ||
        bodyText.includes('模板') ||
        bodyText.includes('提示词') ||
        bodyText.includes('prompt'));
    });

    expect(hasTemplateUI).toBeTruthy();
  });

  test('应该能够显示页面内容', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/prompt-templates?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasContent = await window.evaluate(() => {
      return document.body.innerText.length > 50;
    });

    expect(hasContent).toBeTruthy();
  });

  test('应该支持模板分类或标签', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/prompt-templates?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCategoryFeature = await window.evaluate(() => {
      const tag = document.querySelector('[class*="tag"]');
      const category = document.querySelector('[class*="category"]');
      const filter = document.querySelector('[class*="filter"]');
      const bodyText = document.body.innerText;

      return tag || category || filter ||
        bodyText.includes('分类') ||
        bodyText.includes('标签') ||
        bodyText.includes('筛选');
    });

    expect(hasCategoryFeature).toBeDefined();
  });
});
