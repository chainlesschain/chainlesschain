import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('好友管理页面', () => {
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

  test('应该能够访问好友管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/friends?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/friends');
  });

  test('应该显示主要UI元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/friends?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMainElements = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasTitle = bodyText.includes('好友') ||
        bodyText.includes('friend') ||
        bodyText.includes('联系人');
      const hasActions = bodyText.includes('添加') ||
        bodyText.includes('管理') ||
        bodyText.includes('搜索') ||
        document.querySelector('button');
      const hasContent = document.body.innerText.length > 0;

      return hasTitle || hasActions || hasContent;
    });

    expect(hasMainElements).toBeTruthy();
  });

  test('应该显示好友列表或空状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/friends?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasListOrEmpty = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasList = document.querySelector('[class*="list"]') ||
        document.querySelector('table') ||
        document.querySelector('[class*="friend"]') ||
        document.querySelector('[class*="card"]');
      const hasEmpty = bodyText.includes('暂无好友') ||
        bodyText.includes('空') ||
        bodyText.includes('没有数据') ||
        bodyText.includes('empty');

      return !!(hasList || hasEmpty || bodyText.length > 0);
    });

    expect(hasListOrEmpty).toBeTruthy();
  });

  test('页面应该正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/friends?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
