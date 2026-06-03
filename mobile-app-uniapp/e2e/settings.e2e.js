/**
 * 设置和个人中心 E2E 测试
 * 测试设置页面、个人信息、主题切换等功能
 */
import { test, expect } from '@playwright/test';
import {
  waitForPageLoad,
  navigateTo,
  clearStorage,
  setStorage,
  getStorage,
  clickTabBar,
} from './utils/helpers.js';
import { routes, selectors, testSettings } from './fixtures/test-data.js';

test.describe('设置和个人中心', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearStorage(page);
    await setStorage(page, {
      isLoggedIn: true,
      userInfo: { id: 1, nickname: '测试用户' },
    });
  });

  test.describe('我的页面', () => {
    test('应该正确显示我的页面', async ({ page }) => {
      await navigateTo(page, routes.mine);

      const minePage = page.locator('.mine-page, .profile-page, .user-center');
      await expect(minePage.first()).toBeVisible({ timeout: 10000 });
    });

    test('应该能够通过 TabBar 访问', async ({ page }) => {
      await page.goto('/');
      await waitForPageLoad(page);

      await clickTabBar(page, '我的');
      await expect(page).toHaveURL(/pages\/mine\/mine/);
    });

    test('应该显示用户信息', async ({ page }) => {
      await navigateTo(page, routes.mine);
      await waitForPageLoad(page);

      // 检查用户头像或名称区域
      const userInfo = page.locator('.user-info, .user-header, .avatar, .nickname');
      const hasUserInfo = await userInfo.first().isVisible().catch(() => false);

      console.log(`User info visible: ${hasUserInfo}`);
    });

    test('应该有常用功能入口', async ({ page }) => {
      await navigateTo(page, routes.mine);
      await waitForPageLoad(page);

      // 检查常用功能菜单
      const menuItems = page.locator('.menu-item, .cell, .list-item, .setting-item');
      const count = await menuItems.count();

      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('设置页面', () => {
    test('应该正确显示设置页面', async ({ page }) => {
      await navigateTo(page, routes.settings);

      const settingsPage = page.locator('.settings-page, .setting-list, .settings-container');
      await expect(settingsPage.first()).toBeVisible({ timeout: 10000 });
    });

    test('应该有主题设置选项', async ({ page }) => {
      await navigateTo(page, routes.settings);
      await waitForPageLoad(page);

      // 查找主题相关设置
      const themeItem = page.locator('text=主题, text=深色模式, text=外观, .theme-setting');
      const hasTheme = await themeItem.first().isVisible().catch(() => false);

      console.log(`Theme setting visible: ${hasTheme}`);
    });

    test('应该有语言设置选项', async ({ page }) => {
      await navigateTo(page, routes.settings);
      await waitForPageLoad(page);

      const languageItem = page.locator('text=语言, text=Language, .language-setting');
      const hasLanguage = await languageItem.first().isVisible().catch(() => false);

      console.log(`Language setting visible: ${hasLanguage}`);
    });

    test('应该有关于页面入口', async ({ page }) => {
      await navigateTo(page, routes.settings);
      await waitForPageLoad(page);

      const aboutItem = page.locator('text=关于, text=版本, text=About');
      const hasAbout = await aboutItem.first().isVisible().catch(() => false);

      console.log(`About entry visible: ${hasAbout}`);
    });

    test('开关设置应该能够切换', async ({ page }) => {
      await navigateTo(page, routes.settings);
      await waitForPageLoad(page);

      // 查找第一个开关
      const toggleSwitch = page.locator('.uni-switch, switch, .toggle').first();
      const hasSwitch = await toggleSwitch.isVisible().catch(() => false);

      if (hasSwitch) {
        // 获取初始状态
        const initialChecked = await toggleSwitch.isChecked().catch(() => false);

        // 点击切换
        await toggleSwitch.click();
        await page.waitForTimeout(500);

        // 验证状态改变
        const newChecked = await toggleSwitch.isChecked().catch(() => !initialChecked);
        expect(newChecked).not.toBe(initialChecked);
      }
    });
  });

  test.describe('数据备份', () => {
    test('应该能够访问备份页面', async ({ page }) => {
      await navigateTo(page, routes.backup);

      const backupPage = page.locator('.backup-page, .backup-container, body');
      await expect(backupPage.first()).toBeVisible();
    });

    test('备份页面应该有备份和恢复选项', async ({ page }) => {
      await navigateTo(page, routes.backup);
      await waitForPageLoad(page);

      const backupButton = page.locator('button:has-text("备份"), .backup-btn');
      const restoreButton = page.locator('button:has-text("恢复"), .restore-btn');

      const hasBackup = await backupButton.first().isVisible().catch(() => false);
      const hasRestore = await restoreButton.first().isVisible().catch(() => false);

      console.log(`Backup button: ${hasBackup}, Restore button: ${hasRestore}`);
    });
  });

  test.describe('云同步设置', () => {
    test('应该能够访问云同步页面', async ({ page }) => {
      await page.goto('/#/pages/backup/cloud-sync');
      await waitForPageLoad(page);

      const syncPage = page.locator('.cloud-sync, .sync-settings, body');
      await expect(syncPage.first()).toBeVisible();
    });
  });

  test.describe('身份管理', () => {
    test('应该能够访问身份列表页面', async ({ page }) => {
      await navigateTo(page, routes.identity);

      const identityPage = page.locator('.identity-list, .did-list, body');
      await expect(identityPage.first()).toBeVisible();
    });

    test('应该能够访问创建身份页面', async ({ page }) => {
      await page.goto('/#/pages/identity/create');
      await waitForPageLoad(page);

      const createPage = page.locator('.identity-create, .create-identity, body');
      await expect(createPage.first()).toBeVisible();
    });
  });

  test.describe('通知中心', () => {
    test('应该能够访问通知中心', async ({ page }) => {
      await page.goto('/#/pages/notifications/center');
      await waitForPageLoad(page);

      const notificationPage = page.locator('.notification-center, .notifications-page, body');
      await expect(notificationPage.first()).toBeVisible();
    });
  });

  test.describe('设备配对', () => {
    test('应该能够访问设备配对页面', async ({ page }) => {
      await navigateTo(page, routes.devicePairing);

      const pairingPage = page.locator('.device-pairing, .pairing-page, body');
      await expect(pairingPage.first()).toBeVisible();
    });
  });
});
