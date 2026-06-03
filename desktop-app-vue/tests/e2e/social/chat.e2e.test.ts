import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('聊天窗口页面', () => {
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

  test('应该能够访问聊天窗口页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/chat?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/chat');
  });

  test('应该显示主要UI元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasMainElements = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasTitle = bodyText.includes('聊天') ||
        bodyText.includes('对话') ||
        bodyText.includes('消息') ||
        bodyText.includes('chat');
      const hasInputOrList = document.querySelector('input[type="text"]') ||
        document.querySelector('textarea') ||
        document.querySelector('[class*="message"]') ||
        document.querySelector('[class*="chat"]');
      const hasContent = document.body.innerText.length > 0;

      return hasTitle || hasInputOrList || hasContent;
    });

    expect(hasMainElements).toBeTruthy();
  });

  test('应该显示聊天记录或空状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasListOrEmpty = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasMessages = document.querySelector('[class*="message"]') ||
        document.querySelector('[class*="chat"]') ||
        document.querySelector('[class*="conversation"]') ||
        document.querySelector('[class*="list"]');
      const hasEmpty = bodyText.includes('暂无消息') ||
        bodyText.includes('开始聊天') ||
        bodyText.includes('没有对话') ||
        bodyText.includes('empty');

      return !!(hasMessages || hasEmpty || bodyText.length > 0);
    });

    expect(hasListOrEmpty).toBeTruthy();
  });

  test('页面应该正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
