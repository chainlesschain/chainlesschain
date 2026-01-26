import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('调试根路由', () => {
  let app, window;

  test.beforeEach(async () => {
    const context = await launchElectronApp();
    app = context.app;
    window = context.window;
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
  });

  test('访问根路由看能否渲染MainLayout', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });

    // 等待应用初始化
    let loaded = false;
    let attempts = 0;
    while (!loaded && attempts < 30) {
      await window.waitForTimeout(1000);
      loaded = await window.evaluate(() => {
        const spinElement = document.querySelector('.loading-overlay');
        return !spinElement;
      });
      attempts++;
    }

    console.log(`应用加载完成，等待了 ${attempts} 秒`);
    await window.waitForTimeout(2000);

    const pageInfo = await window.evaluate(() => {
      return {
        url: window.location.href,
        hash: window.location.hash,
        hasMainLayout: !!document.querySelector('.main-layout') || !!document.querySelector('.layout-content'),
        hasLoginPage: document.body.innerHTML.includes('login') || document.body.innerHTML.includes('登录'),
        bodyClasses: document.body.className,
        appContent: document.querySelector('#app')?.innerHTML.substring(0, 500),
      };
    });

    console.log('===== 根路由页面信息 =====');
    console.log('URL:', pageInfo.url);
    console.log('Hash:', pageInfo.hash);
    console.log('Has MainLayout:', pageInfo.hasMainLayout);
    console.log('Has Login Page:', pageInfo.hasLoginPage);
    console.log('Body Classes:', pageInfo.bodyClasses);
    console.log('App Content (前500字符):', pageInfo.appContent);
    console.log('===================');

    expect(true).toBeTruthy();
  });
});
