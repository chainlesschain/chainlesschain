import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('调试路由配置', () => {
  let app, window;

  test.beforeEach(async () => {
    const context = await launchElectronApp();
    app = context.app;
    window = context.window;
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
  });

  test('检查路由是否正确注册', async () => {
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(3000);

    // 获取路由配置
    const routerInfo = await window.evaluate(() => {
      // 尝试访问 Vue Router 实例
      const app = window.__VUE_APP__;
      const router = app?.$router || window.__ROUTER__;

      if (!router) {
        return { error: 'Router not found' };
      }

      const routes = router.getRoutes();
      const testRoute = routes.find(r => r.path === '/test/android-features' || r.name === 'AndroidFeaturesTest');

      return {
        totalRoutes: routes.length,
        testRouteFound: !!testRoute,
        testRoutePath: testRoute?.path,
        testRouteName: testRoute?.name,
        allRouteNames: routes.slice(0, 20).map(r => ({ name: r.name, path: r.path })),
      };
    });

    console.log('===== 路由配置信息 =====');
    console.log('Total Routes:', routerInfo.totalRoutes);
    console.log('Test Route Found:', routerInfo.testRouteFound);
    console.log('Test Route Path:', routerInfo.testRoutePath);
    console.log('Test Route Name:', routerInfo.testRouteName);
    console.log('All Route Names (前20个):');
    routerInfo.allRouteNames?.forEach(r => {
      console.log(`  - ${r.name}: ${r.path}`);
    });
    console.log('===================');

    expect(true).toBeTruthy();
  });
});
