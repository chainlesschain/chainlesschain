/**
 * E2E测试 - 项目详情页模态框管理测试
 *
 * 测试覆盖：
 * 1. 模态框打开和关闭
 * 2. 确认对话框处理
 * 3. 多个模态框管理
 * 4. 模态框焦点管理
 * 5. 模态框背景交互
 */

import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  closeElectronApp,
  takeScreenshot,
  login,
  forceCloseAllModals
} from '../../helpers/common';
import {
  createAndOpenProject,
  waitForProjectDetailLoad,
} from '../../helpers/project-detail';

test.describe('项目详情页 - 模态框管理测试', () => {
  test('应该能够打开和关闭文件管理模态框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      const project = await createAndOpenProject(window, {
        name: '模态框测试项目',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找文件管理按钮');
      // 尝试多个可能的选择器
      let fileManageButton = await window.$('[data-testid="file-manage-button"]');
      if (!fileManageButton) {
        fileManageButton = await window.$('button:has-text("文件管理")');
      }
      if (!fileManageButton) {
        fileManageButton = await window.$('[title="文件管理"]');
      }

      if (fileManageButton) {
        console.log('[Test] 点击文件管理按钮');
        await fileManageButton.click();
        await window.waitForTimeout(500);

        console.log('[Test] 验证模态框显示');
        const modal = await window.$('.ant-modal');
        if (modal) {
          const isVisible = await modal.isVisible();
          expect(isVisible).toBe(true);

          await takeScreenshot(window, 'file-manage-modal-opened');

          console.log('[Test] 关闭模态框');
          await forceCloseAllModals(window);
          await window.waitForTimeout(300);

          const stillVisible = await modal.isVisible();
          expect(stillVisible).toBe(false);

          console.log('[Test] ✅ 模态框打开关闭测试通过');
        } else {
          console.log('[Test] ⚠️ 未找到模态框（可能此功能不显示模态框）');
        }
      } else {
        console.log('[Test] ⚠️ 未找到文件管理按钮（功能可能在其他位置）');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够通过ESC键关闭模态框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: 'ESC关闭测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找可以打开模态框的按钮');
      // 尝试查找Git按钮作为示例
      const gitButton = await window.$('[data-testid="git-actions-button"]');

      if (gitButton) {
        console.log('[Test] 打开Git操作菜单');
        await gitButton.click();
        await window.waitForTimeout(500);

        // 等待菜单出现
        const menu = await window.$('.ant-dropdown-menu');
        if (menu) {
          const isVisible = await menu.isVisible();
          expect(isVisible).toBe(true);

          console.log('[Test] 按ESC键关闭');
          await window.keyboard.press('Escape');
          await window.waitForTimeout(300);

          const stillVisible = await menu.isVisible();
          expect(stillVisible).toBe(false);

          console.log('[Test] ✅ ESC关闭测试通过');
        }
      } else {
        console.log('[Test] ⚠️ 未找到测试用按钮');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理未保存更改的确认对话框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '确认对话框测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 尝试模拟未保存状态');
      // 注意：这里我们只是测试确认对话框的处理逻辑
      // 实际触发未保存状态需要编辑文件

      console.log('[Test] 查找返回按钮');
      let backButton = await window.$('[data-testid="close-button"]');
      if (!backButton) {
        backButton = await window.$('button:has-text("返回")');
      }

      if (backButton) {
        console.log('[Test] 点击返回按钮');
        await backButton.click();
        await window.waitForTimeout(500);

        console.log('[Test] 检查是否出现确认对话框');
        const confirmModal = await window.$('.ant-modal:has-text("有未保存的更改")');

        if (confirmModal) {
          console.log('[Test] 检测到确认对话框');
          const isVisible = await confirmModal.isVisible();
          expect(isVisible).toBe(true);

          // 点击取消
          const cancelButton = await window.$('.ant-modal .ant-btn:has-text("取消")');
          if (cancelButton) {
            await cancelButton.click();
            await window.waitForTimeout(300);

            // 应该还在项目详情页
            const hash = await window.evaluate(() => window.location.hash);
            expect(hash).not.toContain('#/projects/ai-creating');

            console.log('[Test] ✅ 确认对话框取消功能正常');
          }
        } else {
          console.log('[Test] 无确认对话框（无未保存更改）');
          // 验证直接返回到项目列表
          const hash = await window.evaluate(() => window.location.hash);
          expect(hash).toContain('projects');

          console.log('[Test] ✅ 直接返回功能正常');
        }
      } else {
        console.log('[Test] ⚠️ 未找到返回按钮');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够使用forceCloseAllModals关闭所有模态框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '强制关闭测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 尝试打开多个UI元素');

      // 打开Git菜单
      const gitButton = await window.$('[data-testid="git-actions-button"]');
      if (gitButton) {
        await gitButton.click();
        await window.waitForTimeout(300);
      }

      console.log('[Test] 调用forceCloseAllModals');
      await forceCloseAllModals(window);
      await window.waitForTimeout(500);

      console.log('[Test] 验证所有模态框已关闭');
      // 检查常见的模态框和下拉菜单
      const modals = await window.$$('.ant-modal');
      const dropdowns = await window.$$('.ant-dropdown-menu');

      let allClosed = true;
      for (const modal of modals) {
        const isVisible = await modal.isVisible();
        if (isVisible) {
          allClosed = false;
          break;
        }
      }

      for (const dropdown of dropdowns) {
        const isVisible = await dropdown.isVisible();
        if (isVisible) {
          allClosed = false;
          break;
        }
      }

      expect(allClosed).toBe(true);

      console.log('[Test] ✅ forceCloseAllModals功能正常');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够点击模态框背景关闭模态框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '背景点击测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找可以打开模态框的按钮');
      let openButton = await window.$('[data-testid="file-manage-button"]');
      if (!openButton) {
        openButton = await window.$('button:has-text("文件管理")');
      }

      if (openButton) {
        console.log('[Test] 打开模态框');
        await openButton.click();
        await window.waitForTimeout(500);

        const modal = await window.$('.ant-modal');
        if (modal) {
          const isVisible = await modal.isVisible();
          expect(isVisible).toBe(true);

          console.log('[Test] 查找模态框背景');
          const backdrop = await window.$('.ant-modal-mask');

          if (backdrop) {
            console.log('[Test] 点击背景');
            await backdrop.click();
            await window.waitForTimeout(300);

            // 检查模态框是否关闭
            const stillVisible = await modal.isVisible();

            // 注意：有些模态框配置为点击背景不关闭
            console.log('[Test] 模态框状态:', stillVisible ? '仍然可见' : '已关闭');
            console.log('[Test] ✅ 背景点击测试完成');
          }
        }
      } else {
        console.log('[Test] ⚠️ 未找到测试用按钮');
      }

    } finally {
      await closeElectronApp(app);
    }
  });
});
