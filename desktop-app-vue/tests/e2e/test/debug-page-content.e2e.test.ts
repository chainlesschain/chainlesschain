import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('调试页面内容', () => {
  let app, window;

  test.beforeEach(async () => {
    const context = await launchElectronApp();
    app = context.app;
    window = context.window;
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
  });

  test('查看页面实际内容', async () => {
    // 测试独立路由（不在MainLayout下）
    await window.evaluate(() => {
      window.location.hash = '#/test/android-features-standalone';
    });

    await window.waitForSelector('body', { timeout: 10000 });

    // 等待应用初始化完成（loading = false）
    let loaded = false;
    let attempts = 0;
    while (!loaded && attempts < 30) {  // 最多等待30秒
      await window.waitForTimeout(1000);
      loaded = await window.evaluate(() => {
        const spinElement = document.querySelector('.loading-overlay');
        const hasRouterView = document.querySelector('.layout-content') || document.querySelector('.android-features-test-page');
        return !spinElement || hasRouterView;
      });
      attempts++;
    }

    console.log(`应用加载完成，等待了 ${attempts} 秒`);
    await window.waitForTimeout(2000); // 额外等待Vue组件渲染

    // 获取完整的页面HTML和文本
    const pageInfo = await window.evaluate(() => {
      return {
        url: window.location.href,
        hash: window.location.hash,
        bodyText: document.body.innerText,
        bodyHTML: document.body.innerHTML.substring(0, 500), // 前500字符
        hasVueApp: !!document.querySelector('#app'),
        vueAppContent: document.querySelector('#app')?.innerHTML.substring(0, 1000),
        allClasses: Array.from(new Set(
          Array.from(document.querySelectorAll('*')).map(el => el.className).filter(c => c)
        )).slice(0, 20),
        hasRouterView: !!document.querySelector('.layout-content'),
        routerViewContent: document.querySelector('.layout-content')?.innerText.substring(0, 500),
        hasMainLayout: !!document.querySelector('.main-layout') || document.body.innerHTML.includes('MainLayout'),
        hasLoadingOverlay: !!document.querySelector('.loading-overlay'),
        hasLoginPage: document.body.innerHTML.includes('login') || document.body.innerHTML.includes('登录'),
        currentPath: window.location.hash.split('?')[0],
      };
    });

    console.log('===== 页面信息 =====');
    console.log('URL:', pageInfo.url);
    console.log('Hash:', pageInfo.hash);
    console.log('Current Path:', pageInfo.currentPath);
    console.log('Has Vue App:', pageInfo.hasVueApp);
    console.log('Has Loading Overlay:', pageInfo.hasLoadingOverlay);
    console.log('Has Login Page:', pageInfo.hasLoginPage);
    console.log('Has MainLayout:', pageInfo.hasMainLayout);
    console.log('Has RouterView (.layout-content):', pageInfo.hasRouterView);
    console.log('Body Text (前200字符):', pageInfo.bodyText.substring(0, 200));
    console.log('RouterView Content:', pageInfo.routerViewContent);
    console.log('Vue App Content (前1000字符):', pageInfo.vueAppContent);
    console.log('CSS Classes:', pageInfo.allClasses);
    console.log('===================');

    // 这个测试总是通过，只是用来输出调试信息
    expect(true).toBeTruthy();
  });
});
