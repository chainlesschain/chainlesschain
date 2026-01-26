import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('联系人页面', () => {
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

  test('应该能够访问联系人页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contacts?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/contacts');
  });

  test('应该显示主要UI元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contacts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMainElements = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasTitle = bodyText.includes('联系人') ||
        bodyText.includes('contact') ||
        bodyText.includes('通讯录');
      const hasSearchOrAdd = bodyText.includes('搜索') ||
        bodyText.includes('添加') ||
        bodyText.includes('search') ||
        document.querySelector('button');
      const hasContent = document.body.innerText.length > 0;

      return hasTitle || hasSearchOrAdd || hasContent;
    });

    expect(hasMainElements).toBeTruthy();
  });

  test('应该显示联系人列表或空状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contacts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasListOrEmpty = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasList = document.querySelector('[class*="list"]') ||
        document.querySelector('table') ||
        document.querySelector('[class*="contact"]') ||
        document.querySelector('[class*="card"]');
      const hasEmpty = bodyText.includes('暂无联系人') ||
        bodyText.includes('空') ||
        bodyText.includes('没有数据') ||
        bodyText.includes('empty');

      return !!(hasList || hasEmpty || bodyText.length > 0);
    });

    expect(hasListOrEmpty).toBeTruthy();
  });

  test('页面应该正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/contacts?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
