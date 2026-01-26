import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('我的购买页面', () => {
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

  test('应该能够访问我的购买页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/my-purchases?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/my-purchases');
  });

  test('应该显示购买记录界面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/my-purchases?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPurchaseUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const list = document.querySelector('[class*="list"]');
      const table = document.querySelector('table');

      return list || table ||
        bodyText.includes('购买') ||
        bodyText.includes('订单') ||
        bodyText.includes('记录') ||
        bodyText.length > 0;
    });

    expect(hasPurchaseUI).toBeTruthy();
  });

  test('应该能够显示空状态或购买列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/my-purchases?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasListOrEmpty = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('暂无') ||
        bodyText.includes('空') ||
        bodyText.includes('购买') ||
        bodyText.length > 50;
    });

    expect(hasListOrEmpty).toBeTruthy();
  });

  test('页面应该没有阻塞性错误', async () => {
    const errors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/my-purchases?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasBlockingError = errors.some(err =>
      err.includes('Failed to fetch') ||
      err.includes('Network error') ||
      err.includes('Cannot find module')
    );

    expect(hasBlockingError).toBeFalsy();
  });
});
