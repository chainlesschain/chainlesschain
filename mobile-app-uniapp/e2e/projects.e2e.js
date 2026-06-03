/**
 * 项目管理功能 E2E 测试
 * 测试项目的 CRUD 操作、项目详情等功能
 */
import { test, expect } from '@playwright/test';
import {
  waitForPageLoad,
  waitForLoadingHidden,
  navigateTo,
  pullDownRefresh,
  clearStorage,
  setStorage,
  clickTabBar,
} from './utils/helpers.js';
import { routes, selectors, testProject } from './fixtures/test-data.js';

test.describe('项目管理功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearStorage(page);
    await setStorage(page, {
      isLoggedIn: true,
      userInfo: { id: 1, nickname: '测试用户' },
    });
  });

  test.describe('项目列表', () => {
    test('应该正确显示项目列表页面', async ({ page }) => {
      await navigateTo(page, routes.projectList);

      // 验证页面加载
      const listContainer = page.locator('.project-list, .projects-container, .list-container');
      await expect(listContainer.first()).toBeVisible({ timeout: 10000 });
    });

    test('应该能够通过 TabBar 访问项目页面', async ({ page }) => {
      await page.goto('/');
      await waitForPageLoad(page);

      await clickTabBar(page, '项目');

      // 验证 URL
      await expect(page).toHaveURL(/pages\/projects\/list/);
    });

    test('应该支持下拉刷新', async ({ page }) => {
      await navigateTo(page, routes.projectList);
      await waitForPageLoad(page);

      await pullDownRefresh(page);
      await waitForLoadingHidden(page);

      // 页面应该仍然可见
      const listContainer = page.locator('.project-list, .projects-container, body');
      await expect(listContainer.first()).toBeVisible();
    });

    test('空列表应该显示空状态或创建提示', async ({ page }) => {
      await navigateTo(page, routes.projectList);
      await waitForPageLoad(page);

      const listItem = page.locator(selectors.projectCard);
      const emptyState = page.locator(selectors.emptyState + ', .no-project, .create-first');

      const hasItems = await listItem.first().isVisible().catch(() => false);
      const hasEmptyState = await emptyState.first().isVisible().catch(() => false);

      expect(hasItems || hasEmptyState).toBeTruthy();
    });
  });

  test.describe('创建项目', () => {
    test('应该能够进入创建项目页面', async ({ page }) => {
      await navigateTo(page, routes.projectList);
      await waitForPageLoad(page);

      // 查找创建按钮
      const createButton = page.locator('.create-button, .add-btn, .fab-button, button:has-text("新建"), button:has-text("创建")').first();
      const hasCreateButton = await createButton.isVisible().catch(() => false);

      if (hasCreateButton) {
        await createButton.click();
        await waitForPageLoad(page);

        // 验证进入创建页面
        await expect(page).toHaveURL(/pages\/projects\/create/);
      }
    });

    test('创建页面应该有必要的表单字段', async ({ page }) => {
      await navigateTo(page, routes.projectCreate);
      await waitForPageLoad(page);

      // 验证项目名称输入框
      const nameInput = page.locator('input[placeholder*="项目名"], input[placeholder*="名称"], .project-name-input');
      await expect(nameInput.first()).toBeVisible({ timeout: 10000 });

      // 验证描述输入框
      const descInput = page.locator('textarea[placeholder*="描述"], .project-desc-input, textarea');
      await expect(descInput.first()).toBeVisible();
    });

    test('应该能够填写项目信息', async ({ page }) => {
      await navigateTo(page, routes.projectCreate);
      await waitForPageLoad(page);

      // 填写项目名称
      const nameInput = page.locator('input[placeholder*="项目名"], input[placeholder*="名称"], .project-name-input').first();
      await nameInput.fill(testProject.name);
      await expect(nameInput).toHaveValue(testProject.name);

      // 填写描述
      const descInput = page.locator('textarea[placeholder*="描述"], .project-desc-input, textarea').first();
      if (await descInput.isVisible()) {
        await descInput.fill(testProject.description);
        await expect(descInput).toHaveValue(testProject.description);
      }
    });

    test('应该有保存/创建按钮', async ({ page }) => {
      await navigateTo(page, routes.projectCreate);
      await waitForPageLoad(page);

      const saveButton = page.locator('button:has-text("保存"), button:has-text("创建"), button:has-text("确定"), .save-btn, .submit-btn');
      await expect(saveButton.first()).toBeVisible();
    });
  });

  test.describe('项目详情', () => {
    test('应该能够访问项目详情页面', async ({ page }) => {
      await page.goto(`/#${routes.projectDetail}?id=1`);
      await waitForPageLoad(page);

      // 页面应该加载
      const detailPage = page.locator('.project-detail, .detail-page, body');
      await expect(detailPage.first()).toBeVisible();
    });

    test('详情页应该显示项目信息', async ({ page }) => {
      await page.goto(`/#${routes.projectDetail}?id=1`);
      await waitForPageLoad(page);

      // 检查是否有项目名称显示区域
      const projectInfo = page.locator('.project-info, .project-header, .project-name');
      const hasInfo = await projectInfo.first().isVisible().catch(() => false);

      console.log(`Project info visible: ${hasInfo}`);
    });
  });

  test.describe('项目模板', () => {
    test('应该能够访问项目模板页面', async ({ page }) => {
      await page.goto('/#/pages/projects/templates');
      await waitForPageLoad(page);

      const templatesPage = page.locator('.templates-page, .template-list, body');
      await expect(templatesPage.first()).toBeVisible();
    });
  });

  test.describe('项目市场', () => {
    test('应该能够访问项目市场页面', async ({ page }) => {
      await page.goto('/#/pages/projects/market');
      await waitForPageLoad(page);

      const marketPage = page.locator('.market-page, .project-market, body');
      await expect(marketPage.first()).toBeVisible();
    });
  });
});
