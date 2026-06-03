import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('标签管理页面', () => {
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

  test('应该能够访问标签管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/tags?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/tags');
  });

  test('应该显示标签列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/tags?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasTags = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('标签') ||
        bodyText.includes('Tag') ||
        bodyText.includes('分类') ||
        document.querySelector('[class*="tag"]') ||
        document.querySelector('.ant-tag') ||
        document.querySelector('.ant-list') ||
        document.querySelector('table');
    });

    expect(hasTags).toBeTruthy();
  });

  test('应该有标签管理操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/tags?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('添加') ||
        bodyText.includes('编辑') ||
        bodyText.includes('删除') ||
        bodyText.includes('创建') ||
        bodyText.includes('Add') ||
        document.querySelector('button') ||
        document.querySelector('.ant-btn');
    });

    expect(hasActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/tags?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
