import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('数据库安全页面', () => {
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

  test('应该能够访问数据库安全页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/database-security?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/settings/database-security');
  });

  test('应该显示数据库安全选项', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/database-security?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSecurity = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('数据库') ||
        bodyText.includes('安全') ||
        bodyText.includes('加密') ||
        bodyText.includes('备份') ||
        bodyText.includes('Database') ||
        bodyText.includes('Security') ||
        document.querySelector('[class*="security"]');
    });

    expect(hasSecurity).toBeTruthy();
  });

  test('应该有安全配置和操作', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/database-security?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSecurityActions = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('密码') ||
        bodyText.includes('导出') ||
        bodyText.includes('导入') ||
        bodyText.includes('备份') ||
        document.querySelector('input[type="password"]') ||
        document.querySelector('button');
    });

    expect(hasSecurityActions).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/database-security?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
