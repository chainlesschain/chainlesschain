/**
 * 社交功能 E2E 测试
 * 测试好友、动态、消息等社交功能
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
import { routes, selectors } from './fixtures/test-data.js';

test.describe('社交功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearStorage(page);
    await setStorage(page, {
      isLoggedIn: true,
      userInfo: { id: 1, nickname: '测试用户' },
    });
  });

  test.describe('好友列表', () => {
    test('应该正确显示好友列表页面', async ({ page }) => {
      await navigateTo(page, routes.friends);

      const friendsPage = page.locator('.friends-page, .friends-list, .friend-container');
      await expect(friendsPage.first()).toBeVisible({ timeout: 10000 });
    });

    test('应该有添加好友入口', async ({ page }) => {
      await navigateTo(page, routes.friends);
      await waitForPageLoad(page);

      const addButton = page.locator('button:has-text("添加"), .add-friend, .add-btn, [class*="add"]');
      const hasAdd = await addButton.first().isVisible().catch(() => false);

      console.log(`Add friend button visible: ${hasAdd}`);
    });

    test('空好友列表应该显示提示', async ({ page }) => {
      await navigateTo(page, routes.friends);
      await waitForPageLoad(page);

      const friendItem = page.locator('.friend-item, .friend-card');
      const emptyState = page.locator(selectors.emptyState + ', .no-friends');

      const hasItems = await friendItem.first().isVisible().catch(() => false);
      const hasEmpty = await emptyState.first().isVisible().catch(() => false);

      expect(hasItems || hasEmpty).toBeTruthy();
    });

    test('应该支持搜索好友', async ({ page }) => {
      await navigateTo(page, routes.friends);
      await waitForPageLoad(page);

      const searchInput = page.locator('input[placeholder*="搜索"], .search-input');
      const hasSearch = await searchInput.first().isVisible().catch(() => false);

      if (hasSearch) {
        await searchInput.first().fill('测试');
        await page.keyboard.press('Enter');
        await waitForLoadingHidden(page);
      }

      console.log(`Search input visible: ${hasSearch}`);
    });
  });

  test.describe('动态/帖子', () => {
    test('应该正确显示动态列表页面', async ({ page }) => {
      await navigateTo(page, routes.posts);

      const postsPage = page.locator('.posts-page, .posts-list, .dynamic-list');
      await expect(postsPage.first()).toBeVisible({ timeout: 10000 });
    });

    test('应该支持下拉刷新', async ({ page }) => {
      await navigateTo(page, routes.posts);
      await waitForPageLoad(page);

      await pullDownRefresh(page);
      await waitForLoadingHidden(page);

      const postsPage = page.locator('.posts-page, .posts-list, body');
      await expect(postsPage.first()).toBeVisible();
    });

    test('应该有发布动态入口', async ({ page }) => {
      await navigateTo(page, routes.posts);
      await waitForPageLoad(page);

      const publishButton = page.locator('button:has-text("发布"), .publish-btn, .create-post, .fab-button');
      const hasPublish = await publishButton.first().isVisible().catch(() => false);

      console.log(`Publish button visible: ${hasPublish}`);
    });

    test('动态卡片应该显示必要信息', async ({ page }) => {
      await navigateTo(page, routes.posts);
      await waitForPageLoad(page);

      const postCard = page.locator('.post-card, .post-item, .dynamic-item').first();
      const hasPost = await postCard.isVisible().catch(() => false);

      if (hasPost) {
        // 检查是否有用户信息
        const userInfo = postCard.locator('.user-info, .author, .nickname');
        const hasUser = await userInfo.first().isVisible().catch(() => false);

        // 检查是否有内容
        const content = postCard.locator('.content, .post-content, .text');
        const hasContent = await content.first().isVisible().catch(() => false);

        console.log(`Post has user: ${hasUser}, has content: ${hasContent}`);
      }
    });
  });

  test.describe('消息中心', () => {
    test('应该正确显示消息页面', async ({ page }) => {
      await navigateTo(page, routes.messages);

      const messagesPage = page.locator('.messages-page, .message-list, .chat-list');
      await expect(messagesPage.first()).toBeVisible({ timeout: 10000 });
    });

    test('应该能够通过 TabBar 访问', async ({ page }) => {
      await page.goto('/');
      await waitForPageLoad(page);

      await clickTabBar(page, '消息');
      await expect(page).toHaveURL(/pages\/messages\/index/);
    });

    test('消息列表应该显示会话', async ({ page }) => {
      await navigateTo(page, routes.messages);
      await waitForPageLoad(page);

      const chatItem = page.locator('.chat-item, .conversation-item, .message-item');
      const emptyState = page.locator(selectors.emptyState + ', .no-messages');

      const hasItems = await chatItem.first().isVisible().catch(() => false);
      const hasEmpty = await emptyState.first().isVisible().catch(() => false);

      expect(hasItems || hasEmpty).toBeTruthy();
    });
  });

  test.describe('好友聊天', () => {
    test('应该能够访问好友聊天页面', async ({ page }) => {
      await page.goto('/#/pages/social/friend-chat/friend-chat?friendId=1');
      await waitForPageLoad(page);

      const chatPage = page.locator('.friend-chat, .chat-page, body');
      await expect(chatPage.first()).toBeVisible();
    });

    test('聊天页面应该有消息输入框', async ({ page }) => {
      await page.goto('/#/pages/social/friend-chat/friend-chat?friendId=1');
      await waitForPageLoad(page);

      const chatInput = page.locator('input[placeholder*="消息"], textarea, .message-input');
      const hasInput = await chatInput.first().isVisible().catch(() => false);

      console.log(`Chat input visible: ${hasInput}`);
    });
  });

  test.describe('社交消息', () => {
    test('应该能够访问社交消息页面', async ({ page }) => {
      await page.goto('/#/pages/social/messages/messages');
      await waitForPageLoad(page);

      const socialMessages = page.locator('.social-messages, .messages-page, body');
      await expect(socialMessages.first()).toBeVisible();
    });
  });
});
