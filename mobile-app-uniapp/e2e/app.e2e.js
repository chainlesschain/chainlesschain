/**
 * 应用基础功能 E2E 测试
 * 测试应用启动、导航、TabBar 等核心功能
 */
import { test, expect } from '@playwright/test';
import { waitForPageLoad, clickTabBar, clearStorage } from './utils/helpers.js';
import { routes, selectors } from './fixtures/test-data.js';

test.describe('应用基础功能', () => {
  test.beforeEach(async ({ page }) => {
    // 清除存储，确保干净的测试环境
    await page.goto('/');
    await clearStorage(page);
  });

  test('应用应该成功加载首页', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // 验证页面标题
    await expect(page).toHaveTitle(/ChainlessChain/);

    // 验证 TabBar 存在
    const tabBar = page.locator(selectors.tabBar);
    await expect(tabBar).toBeVisible();

    // 验证首页内容加载
    const content = page.locator('.page-content, .home-content, .index-content');
    await expect(content.first()).toBeVisible({ timeout: 10000 });
  });

  test('TabBar 导航应该正常工作', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // 点击 "项目" Tab
    await clickTabBar(page, '项目');
    await expect(page).toHaveURL(/pages\/projects\/list/);

    // 点击 "消息" Tab
    await clickTabBar(page, '消息');
    await expect(page).toHaveURL(/pages\/messages\/index/);

    // 点击 "知识" Tab
    await clickTabBar(page, '知识');
    await expect(page).toHaveURL(/pages\/knowledge\/list\/list/);

    // 点击 "我的" Tab
    await clickTabBar(page, '我的');
    await expect(page).toHaveURL(/pages\/mine\/mine/);

    // 返回首页
    await clickTabBar(page, '首页');
    await expect(page).toHaveURL(/pages\/index\/index/);
  });

  test('页面应该正确响应返回操作', async ({ page }) => {
    // 导航到知识列表
    await page.goto(`/#${routes.knowledgeList}`);
    await waitForPageLoad(page);

    // 尝试进入详情页（如果有数据的话）
    const listItem = page.locator(selectors.listItem).first();
    const hasItems = await listItem.isVisible().catch(() => false);

    if (hasItems) {
      await listItem.click();
      await waitForPageLoad(page);

      // 点击返回按钮
      const backButton = page.locator(selectors.backButton);
      if (await backButton.isVisible()) {
        await backButton.click();
        await waitForPageLoad(page);

        // 验证回到列表页
        await expect(page).toHaveURL(/pages\/knowledge\/list/);
      }
    }
  });

  test('应用应该正确处理深度链接', async ({ page }) => {
    // 直接访问设置页面
    await page.goto(`/#${routes.settings}`);
    await waitForPageLoad(page);

    // 验证页面加载
    const settingsContent = page.locator('.settings-page, .setting-list');
    await expect(settingsContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('页面刷新后应该保持状态', async ({ page }) => {
    // 导航到知识页面
    await page.goto(`/#${routes.knowledgeList}`);
    await waitForPageLoad(page);

    // 刷新页面
    await page.reload();
    await waitForPageLoad(page);

    // 验证仍在知识页面
    await expect(page).toHaveURL(/pages\/knowledge\/list/);
  });
});

test.describe('响应式布局', () => {
  test('应该在移动端视口正确显示', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await waitForPageLoad(page);

    // TabBar 应该可见
    const tabBar = page.locator(selectors.tabBar);
    await expect(tabBar).toBeVisible();

    // 内容区域应该填满屏幕宽度
    const content = page.locator('.page-content, .home-content, .index-content').first();
    if (await content.isVisible()) {
      const box = await content.boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThan(350);
      }
    }
  });

  test('应该在平板视口正确显示', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await waitForPageLoad(page);

    // 验证页面正常渲染
    const tabBar = page.locator(selectors.tabBar);
    await expect(tabBar).toBeVisible();
  });
});
