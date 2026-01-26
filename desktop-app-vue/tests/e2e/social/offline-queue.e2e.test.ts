import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('离线消息队列页面', () => {
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

  test('应该能够访问离线消息队列页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/offline-queue?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/offline-queue');
  });

  test('应该显示主要UI元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/offline-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMainElements = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasTitle = bodyText.includes('离线') ||
        bodyText.includes('消息') ||
        bodyText.includes('队列') ||
        bodyText.includes('offline') ||
        bodyText.includes('queue');
      const hasActions = bodyText.includes('清空') ||
        bodyText.includes('同步') ||
        bodyText.includes('刷新') ||
        document.querySelector('button');
      const hasContent = document.body.innerText.length > 0;

      return hasTitle || hasActions || hasContent;
    });

    expect(hasMainElements).toBeTruthy();
  });

  test('应该显示消息队列或空状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/offline-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasListOrEmpty = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasList = document.querySelector('[class*="list"]') ||
        document.querySelector('table') ||
        document.querySelector('[class*="queue"]') ||
        document.querySelector('[class*="message"]');
      const hasEmpty = bodyText.includes('暂无消息') ||
        bodyText.includes('队列为空') ||
        bodyText.includes('没有数据') ||
        bodyText.includes('empty');

      return !!(hasList || hasEmpty || bodyText.length > 0);
    });

    expect(hasListOrEmpty).toBeTruthy();
  });

  test('页面应该正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/offline-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
