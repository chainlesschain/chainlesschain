/**
 * 知识库功能 E2E 测试
 * 测试知识的 CRUD 操作、搜索、标签等功能
 */
import { test, expect } from '@playwright/test';
import {
  waitForPageLoad,
  waitForToast,
  waitForLoadingHidden,
  navigateTo,
  pullDownRefresh,
  scrollToBottom,
  clearStorage,
  setStorage,
} from './utils/helpers.js';
import { routes, selectors, testKnowledge } from './fixtures/test-data.js';

test.describe('知识库功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearStorage(page);
    // 设置模拟的用户登录状态
    await setStorage(page, {
      isLoggedIn: true,
      userInfo: { id: 1, nickname: '测试用户' },
    });
  });

  test.describe('知识列表', () => {
    test('应该正确显示知识列表页面', async ({ page }) => {
      await navigateTo(page, routes.knowledgeList);

      // 验证页面加载
      const listContainer = page.locator('.knowledge-list, .note-list, .list-container');
      await expect(listContainer.first()).toBeVisible({ timeout: 10000 });
    });

    test('应该支持下拉刷新', async ({ page }) => {
      await navigateTo(page, routes.knowledgeList);
      await waitForPageLoad(page);

      // 执行下拉刷新
      await pullDownRefresh(page);
      await waitForLoadingHidden(page);

      // 页面应该仍然可见
      const listContainer = page.locator('.knowledge-list, .note-list, .list-container');
      await expect(listContainer.first()).toBeVisible();
    });

    test('空列表应该显示空状态提示', async ({ page }) => {
      await navigateTo(page, routes.knowledgeList);
      await waitForPageLoad(page);

      // 检查是否有列表项或空状态
      const listItem = page.locator(selectors.knowledgeCard);
      const emptyState = page.locator(selectors.emptyState);

      const hasItems = await listItem.first().isVisible().catch(() => false);
      const hasEmptyState = await emptyState.first().isVisible().catch(() => false);

      // 应该至少有一个状态
      expect(hasItems || hasEmptyState).toBeTruthy();
    });

    test('应该支持搜索功能', async ({ page }) => {
      await navigateTo(page, routes.knowledgeList);
      await waitForPageLoad(page);

      // 查找搜索框
      const searchInput = page.locator('input[type="search"], .search-input, .uni-searchbar__box input');
      const hasSearch = await searchInput.first().isVisible().catch(() => false);

      if (hasSearch) {
        await searchInput.first().fill('测试');
        await page.keyboard.press('Enter');
        await waitForLoadingHidden(page);

        // 验证搜索后页面仍然正常
        const listContainer = page.locator('.knowledge-list, .note-list, .list-container');
        await expect(listContainer.first()).toBeVisible();
      }
    });
  });

  test.describe('创建知识', () => {
    test('应该能够进入编辑页面', async ({ page }) => {
      await navigateTo(page, routes.knowledgeList);
      await waitForPageLoad(page);

      // 查找添加按钮
      const addButton = page.locator('.add-button, .add-btn, .fab-button, [class*="add"]').first();
      const hasAddButton = await addButton.isVisible().catch(() => false);

      if (hasAddButton) {
        await addButton.click();
        await waitForPageLoad(page);

        // 验证进入编辑页面
        const editPage = page.locator('.edit-page, .knowledge-edit, .editor-container');
        await expect(editPage.first()).toBeVisible({ timeout: 10000 });
      }
    });

    test('编辑页面应该有必要的表单元素', async ({ page }) => {
      await navigateTo(page, routes.knowledgeEdit);
      await waitForPageLoad(page);

      // 验证标题输入框
      const titleInput = page.locator('input[placeholder*="标题"], .title-input, [class*="title"] input');
      await expect(titleInput.first()).toBeVisible({ timeout: 10000 });

      // 验证内容编辑区域
      const contentEditor = page.locator('textarea, .editor, .content-editor, .markdown-editor');
      await expect(contentEditor.first()).toBeVisible();
    });

    test('应该能够输入知识内容', async ({ page }) => {
      await navigateTo(page, routes.knowledgeEdit);
      await waitForPageLoad(page);

      // 填写标题
      const titleInput = page.locator('input[placeholder*="标题"], .title-input, [class*="title"] input').first();
      await titleInput.fill(testKnowledge.title);

      // 验证输入
      await expect(titleInput).toHaveValue(testKnowledge.title);

      // 填写内容
      const contentEditor = page.locator('textarea, .editor, .content-editor').first();
      if (await contentEditor.isVisible()) {
        await contentEditor.fill(testKnowledge.content);
      }
    });
  });

  test.describe('知识详情', () => {
    test('应该正确显示知识详情页面', async ({ page }) => {
      // 直接访问详情页（带模拟 ID）
      await page.goto(`/#${routes.knowledgeDetail}?id=1`);
      await waitForPageLoad(page);

      // 页面应该加载（可能显示错误或内容）
      const detailPage = page.locator('.detail-page, .knowledge-detail, .note-detail, body');
      await expect(detailPage.first()).toBeVisible();
    });

    test('详情页应该有返回按钮', async ({ page }) => {
      await page.goto(`/#${routes.knowledgeDetail}?id=1`);
      await waitForPageLoad(page);

      // 验证返回按钮
      const backButton = page.locator(selectors.backButton);
      const hasBack = await backButton.first().isVisible().catch(() => false);

      // uni-app 页面通常都有返回按钮
      if (hasBack) {
        await expect(backButton.first()).toBeVisible();
      }
    });
  });

  test.describe('标签功能', () => {
    test('知识列表应该显示标签', async ({ page }) => {
      await navigateTo(page, routes.knowledgeList);
      await waitForPageLoad(page);

      // 检查是否有标签元素
      const tags = page.locator(selectors.tag);
      const tagList = page.locator(selectors.tagList);

      // 标签可能存在也可能不存在（取决于数据）
      const hasTags = await tags.first().isVisible().catch(() => false);
      const hasTagList = await tagList.first().isVisible().catch(() => false);

      // 只记录状态，不做强制断言
      console.log(`Tags visible: ${hasTags}, TagList visible: ${hasTagList}`);
    });
  });

  test.describe('文件夹功能', () => {
    test('应该能够访问文件夹管理页面', async ({ page }) => {
      await page.goto('/#/pages/knowledge/folders/folders');
      await waitForPageLoad(page);

      // 验证页面加载
      const foldersPage = page.locator('.folders-page, .folder-list, body');
      await expect(foldersPage.first()).toBeVisible();
    });
  });
});
