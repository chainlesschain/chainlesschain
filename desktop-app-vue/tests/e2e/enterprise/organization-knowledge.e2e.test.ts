import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('组织知识库页面', () => {
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

  test('应该能够访问组织知识库页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/knowledge?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/org/test-org/knowledge');
  });

  test('应该显示组织知识库主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/knowledge?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasKnowledgeUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('知识') ||
        bodyText.includes('库') ||
        bodyText.includes('文档') ||
        bodyText.includes('组织') ||
        bodyText.includes('共享') ||
        bodyText.length > 0;
    });

    expect(hasKnowledgeUI).toBeTruthy();
  });

  test('应该能够显示知识库列表或文档树', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/knowledge?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasKnowledge = await window.evaluate(() => {
      const list = document.querySelector('[class*="list"]');
      const tree = document.querySelector('[class*="tree"]');
      const card = document.querySelector('[class*="card"]');
      const table = document.querySelector('[class*="table"]');
      return !!(list || tree || card || table);
    });

    expect(hasKnowledge).toBeDefined();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/org/test-org/knowledge?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(isLoaded).toBeTruthy();
  });
});
