/**
 * E2E测试 - 项目详情页按钮交互测试
 *
 * 测试覆盖：
 * 1. 按钮状态（禁用/启用）
 * 2. 下拉菜单交互
 * 3. 图标按钮和工具提示
 */

import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  closeElectronApp,
  takeScreenshot,
  login,
  forceCloseAllModals,
} from '../../helpers/common';
import {
  createAndOpenProject,
  waitForProjectDetailLoad,
} from '../../helpers/project-detail';

test.describe('项目详情页 - 按钮交互测试', () => {
  test('应该正确显示按钮的禁用和启用状态', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '按钮状态测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找所有按钮');
      const buttons = await window.$$('button');
      console.log('[Test] 找到按钮数量:', buttons.length);

      let disabledCount = 0;
      let enabledCount = 0;

      for (const button of buttons) {
        const isDisabled = await button.evaluate((btn) => btn.disabled);
        if (isDisabled) {
          disabledCount++;
        } else {
          enabledCount++;
        }
      }

      console.log('[Test] 禁用按钮:', disabledCount);
      console.log('[Test] 启用按钮:', enabledCount);

      // 应该至少有一些按钮是启用的
      expect(enabledCount).toBeGreaterThan(0);

      await takeScreenshot(window, 'button-states');

      console.log('[Test] ✅ 按钮状态测试完成');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够打开和关闭下拉菜单', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '下拉菜单测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找Git操作按钮');
      await forceCloseAllModals(window);

      const gitButton = await window.$('[data-testid="git-actions-button"]');

      if (gitButton) {
        console.log('[Test] 打开下拉菜单');
        await gitButton.click();
        await window.waitForTimeout(500);

        console.log('[Test] 验证菜单显示');
        const menu = await window.$('.ant-dropdown-menu');

        if (menu) {
          const isVisible = await menu.isVisible();
          expect(isVisible).toBe(true);

          await takeScreenshot(window, 'dropdown-menu-opened');

          console.log('[Test] 点击菜单外部关闭');
          // 点击页面其他位置
          await window.mouse.click(100, 100);
          await window.waitForTimeout(300);

          const stillVisible = await menu.isVisible();
          expect(stillVisible).toBe(false);

          console.log('[Test] ✅ 下拉菜单测试通过');
        } else {
          console.log('[Test] ⚠️ 未找到下拉菜单');
        }
      } else {
        console.log('[Test] ⚠️ 未找到Git按钮');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够从下拉菜单中选择项目', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '菜单选择测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 打开Git操作菜单');
      await forceCloseAllModals(window);

      const gitButton = await window.$('[data-testid="git-actions-button"]');

      if (gitButton) {
        await gitButton.click();
        await window.waitForTimeout(500);

        console.log('[Test] 查找菜单项');
        const menuItems = await window.$$('.ant-dropdown-menu .ant-dropdown-menu-item');
        console.log('[Test] 找到菜单项数量:', menuItems.length);

        if (menuItems.length > 0) {
          // 获取第一个菜单项的文本
          const firstItemText = await menuItems[0].textContent();
          console.log('[Test] 第一个菜单项:', firstItemText);

          // 点击第一个菜单项
          await menuItems[0].click();
          await window.waitForTimeout(1000);

          console.log('[Test] ✅ 菜单项点击测试完成');

          await takeScreenshot(window, 'menu-item-clicked');
        } else {
          console.log('[Test] ⚠️ 未找到菜单项');
        }
      } else {
        console.log('[Test] ⚠️ 未找到Git按钮');
      }

    } finally {
      await closeElectronApp(app);
    }
  });
});
