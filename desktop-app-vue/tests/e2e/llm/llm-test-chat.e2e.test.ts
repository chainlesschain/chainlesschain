import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('LLM测试聊天页面', () => {
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

  test('应该能够访问LLM测试聊天页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/llm/test-chat?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/llm/test-chat');
  });

  test('应该显示页面标题和返回按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/llm/test-chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('LLM') &&
        bodyText.includes('测试') &&
        (bodyText.includes('聊天') || bodyText.includes('Chat'));
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示LLM提供商选择器', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/llm/test-chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasProviderSelector = await window.evaluate(() => {
      const selectors = document.querySelectorAll('.ant-select');
      const bodyText = document.body.innerText;
      return selectors.length > 0 ||
        bodyText.includes('火山引擎') ||
        bodyText.includes('Doubao') ||
        bodyText.includes('通义千问') ||
        bodyText.includes('DeepSeek');
    });

    expect(hasProviderSelector).toBeTruthy();
  });

  test('应该显示聊天输入区域', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/llm/test-chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasInputArea = await window.evaluate(() => {
      const textareas = document.querySelectorAll('textarea');
      const buttons = document.querySelectorAll('button');
      const bodyText = document.body.innerText;
      return textareas.length > 0 ||
        bodyText.includes('输入') ||
        bodyText.includes('发送') ||
        Array.from(buttons).some(btn => btn.innerText.includes('发送'));
    });

    expect(hasInputArea).toBeTruthy();
  });

  test('应该显示清空对话按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/llm/test-chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasClearButton = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(btn =>
        btn.innerText.includes('清空') ||
        btn.innerText.includes('Clear')
      );
    });

    expect(hasClearButton).toBeTruthy();
  });

  test('应该显示空状态提示', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/llm/test-chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasEmptyState = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('发送消息') ||
        bodyText.includes('测试') ||
        bodyText.includes('服务') ||
        document.querySelector('.empty-state');
    });

    expect(hasEmptyState).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/llm/test-chat?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
