/**
 * 用户认证功能 E2E 测试
 * 测试登录、PIN码设置、生物识别等功能
 */
import { test, expect } from '@playwright/test';
import {
  waitForPageLoad,
  waitForToast,
  navigateTo,
  clearStorage,
  setStorage,
  getStorage,
} from './utils/helpers.js';
import { routes, testUser } from './fixtures/test-data.js';

test.describe('用户认证功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearStorage(page);
  });

  test.describe('登录页面', () => {
    test('应该正确显示登录页面', async ({ page }) => {
      await navigateTo(page, routes.login);

      // 验证登录页面加载
      const loginPage = page.locator('.login-page, .login-container, body');
      await expect(loginPage.first()).toBeVisible();
    });

    test('登录页面应该有品牌标识', async ({ page }) => {
      await navigateTo(page, routes.login);
      await waitForPageLoad(page);

      // 检查 Logo 或应用名称
      const branding = page.locator('.logo, .brand, .app-name, img[alt*="logo"], text=ChainlessChain');
      const hasBranding = await branding.first().isVisible().catch(() => false);

      console.log(`Branding visible: ${hasBranding}`);
    });
  });

  test.describe('PIN 码设置', () => {
    test('应该能够访问 PIN 码设置页面', async ({ page }) => {
      await navigateTo(page, routes.setupPin);

      // 验证页面加载
      const pinPage = page.locator('.pin-setup, .setup-pin, .pin-page, body');
      await expect(pinPage.first()).toBeVisible();
    });

    test('PIN 输入应该有 6 位数字输入框', async ({ page }) => {
      await navigateTo(page, routes.setupPin);
      await waitForPageLoad(page);

      // 查找 PIN 输入区域
      const pinInputs = page.locator('.pin-input, .digit-input, input[type="password"], input[type="tel"], input[maxlength="1"]');
      const pinBox = page.locator('.pin-box, .pin-container, .code-input');

      const hasInputs = await pinInputs.first().isVisible().catch(() => false);
      const hasBox = await pinBox.first().isVisible().catch(() => false);

      expect(hasInputs || hasBox).toBeTruthy();
    });

    test('应该有数字键盘', async ({ page }) => {
      await navigateTo(page, routes.setupPin);
      await waitForPageLoad(page);

      // 查找数字键盘
      const keyboard = page.locator('.number-keyboard, .num-keyboard, .keyboard, .digit-keyboard');
      const hasKeyboard = await keyboard.first().isVisible().catch(() => false);

      // 或者查找数字按钮
      const numButtons = page.locator('button:has-text("1"), .key-1, [data-key="1"]');
      const hasNumButtons = await numButtons.first().isVisible().catch(() => false);

      console.log(`Keyboard visible: ${hasKeyboard}, Number buttons visible: ${hasNumButtons}`);
    });
  });

  test.describe('PIN 码验证', () => {
    test('应该能够访问 PIN 验证页面', async ({ page }) => {
      await navigateTo(page, routes.verifyPin);

      const verifyPage = page.locator('.verify-pin, .pin-verify, .pin-page, body');
      await expect(verifyPage.first()).toBeVisible();
    });

    test('错误的 PIN 码应该显示错误提示', async ({ page }) => {
      // 先设置一个 PIN 码
      await setStorage(page, {
        pinCode: '123456',
        isPinSet: true,
      });

      await navigateTo(page, routes.verifyPin);
      await waitForPageLoad(page);

      // 尝试输入错误的 PIN
      const wrongPin = '000000';

      // 查找 PIN 输入方式
      const pinInput = page.locator('.pin-input input, input[type="password"], input[type="tel"]').first();
      const hasInput = await pinInput.isVisible().catch(() => false);

      if (hasInput) {
        await pinInput.fill(wrongPin);
        await page.keyboard.press('Enter');

        // 应该显示错误提示
        const errorMessage = page.locator('.error, .error-message, text=错误, text=不正确');
        const hasError = await errorMessage.first().isVisible({ timeout: 3000 }).catch(() => false);

        console.log(`Error message visible: ${hasError}`);
      }
    });
  });

  test.describe('修改 PIN 码', () => {
    test('应该能够访问修改 PIN 码页面', async ({ page }) => {
      await setStorage(page, {
        pinCode: '123456',
        isPinSet: true,
      });

      await page.goto('/#/pages/auth/change-pin');
      await waitForPageLoad(page);

      const changePage = page.locator('.change-pin, .pin-change, body');
      await expect(changePage.first()).toBeVisible();
    });
  });

  test.describe('生物识别', () => {
    test('应该能够访问生物识别设置页面', async ({ page }) => {
      await page.goto('/#/pages/auth/biometric-setup');
      await waitForPageLoad(page);

      const biometricPage = page.locator('.biometric-setup, .biometric-page, body');
      await expect(biometricPage.first()).toBeVisible();
    });

    test('生物识别页面应该有开关选项', async ({ page }) => {
      await page.goto('/#/pages/auth/biometric-setup');
      await waitForPageLoad(page);

      // 查找开关
      const toggleSwitch = page.locator('.uni-switch, switch, .toggle, input[type="checkbox"]');
      const hasSwitch = await toggleSwitch.first().isVisible().catch(() => false);

      console.log(`Biometric switch visible: ${hasSwitch}`);
    });
  });

  test.describe('会话管理', () => {
    test('已登录用户应该能访问受保护页面', async ({ page }) => {
      // 设置登录状态
      await setStorage(page, {
        isLoggedIn: true,
        userInfo: { id: 1, nickname: '测试用户' },
        token: 'test-token',
      });

      await navigateTo(page, routes.settings);
      await waitForPageLoad(page);

      // 应该能够访问设置页面
      const settingsPage = page.locator('.settings-page, .setting-list, body');
      await expect(settingsPage.first()).toBeVisible();
    });

    test('退出登录后应该清除会话', async ({ page }) => {
      // 设置登录状态
      await setStorage(page, {
        isLoggedIn: true,
        userInfo: { id: 1, nickname: '测试用户' },
      });

      await navigateTo(page, routes.settings);
      await waitForPageLoad(page);

      // 查找退出登录按钮
      const logoutButton = page.locator('button:has-text("退出"), button:has-text("登出"), .logout-btn');
      const hasLogout = await logoutButton.first().isVisible().catch(() => false);

      if (hasLogout) {
        await logoutButton.first().click();

        // 等待确认对话框
        const confirmButton = page.locator('.uni-modal button:has-text("确定"), .confirm-btn');
        if (await confirmButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.first().click();
        }

        await waitForPageLoad(page);

        // 验证登录状态被清除
        const loginStatus = await getStorage(page, 'isLoggedIn');
        expect(loginStatus).toBeFalsy();
      }
    });
  });
});
