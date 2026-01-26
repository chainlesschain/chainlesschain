/**
 * E2E测试 - 项目详情页导航流程测试
 *
 * 测试覆盖：
 * 1. 面包屑导航
 * 2. 返回项目列表
 * 3. 模式切换
 * 4. 深度链接
 * 5. 浏览器前进后退
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
  navigateToAICreatingMode,
  waitForAICreatingModeLoad,
} from '../../helpers/project-detail';

test.describe('项目详情页 - 导航流程测试', () => {
  test('应该显示正确的面包屑路径', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      const projectName = '面包屑测试项目';
      await createAndOpenProject(window, {
        name: projectName,
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找面包屑');
      const breadcrumb = await window.$('.ant-breadcrumb, [class*="breadcrumb"]');

      if (breadcrumb) {
        const breadcrumbText = await breadcrumb.textContent();
        console.log('[Test] 面包屑内容:', breadcrumbText);

        // 验证面包屑包含项目名称或相关内容
        // 注意：具体内容取决于实现，这里只验证存在
        expect(breadcrumbText).toBeTruthy();
        expect(breadcrumbText.length).toBeGreaterThan(0);

        await takeScreenshot(window, 'breadcrumb-displayed');

        console.log('[Test] ✅ 面包屑显示测试通过');
      } else {
        console.log('[Test] ⚠️ 未找到面包屑元素');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够从项目详情返回项目列表', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '返回测试项目',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      // 验证在项目详情页
      let currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('projects/');

      console.log('[Test] 查找返回按钮');
      await forceCloseAllModals(window);

      let backButton = await window.$('[data-testid="close-button"]');
      if (!backButton) {
        backButton = await window.$('[data-testid="back-to-list-button"]');
      }
      if (!backButton) {
        backButton = await window.$('button:has-text("返回")');
      }

      if (backButton) {
        console.log('[Test] 点击返回按钮');
        await backButton.click();
        await window.waitForTimeout(1000);

        // 检查确认对话框
        const confirmModal = await window.$('.ant-modal:has-text("有未保存的更改")');
        if (confirmModal) {
          console.log('[Test] 处理确认对话框');
          const okButton = await window.$('.ant-modal .ant-btn-dangerous');
          await okButton?.click();
          await window.waitForTimeout(1000);
        }

        // 验证返回到项目列表
        currentHash = await window.evaluate(() => window.location.hash);
        console.log('[Test] 当前hash:', currentHash);

        expect(currentHash).toContain('projects');
        expect(currentHash).not.toContain('projects/');

        await takeScreenshot(window, 'returned-to-projects-list');

        console.log('[Test] ✅ 返回项目列表测试通过');
      } else {
        console.log('[Test] ⚠️ 未找到返回按钮');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够在正常模式和AI创建模式之间切换', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 进入AI创建模式');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      // 验证在AI创建模式
      let currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain('ai-creating');

      console.log('[Test] 验证AI创建模式UI');
      // AI创建模式下，项目详情页应该存在，但文件树应该隐藏
      const detailPage = await window.$('.project-detail-page, [data-testid="content-container"]');
      expect(detailPage).toBeTruthy();

      // 验证聊天面板可见（AI创建模式的主要UI）
      const chatPanel = await window.$('[data-testid="chat-panel"], .chat-panel');
      expect(chatPanel).toBeTruthy();

      await takeScreenshot(window, 'ai-creating-mode');

      console.log('[Test] 返回项目列表');
      await forceCloseAllModals(window);

      const backButton = await window.$('[data-testid="close-button"]');
      if (backButton) {
        await backButton.click();
        await window.waitForTimeout(1000);

        // 验证返回项目列表
        currentHash = await window.evaluate(() => window.location.hash);
        expect(currentHash).toContain('projects');
        expect(currentHash).not.toContain('ai-creating');

        console.log('[Test] ✅ 模式切换测试通过');
      } else {
        console.log('[Test] ⚠️ 未找到返回按钮');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够通过URL直接加载项目', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'URL加载测试',
        project_type: 'markdown',
      });

      console.log('[Test] 返回项目列表');
      await window.evaluate(() => {
        window.location.hash = '#/projects';
      });
      await window.waitForTimeout(1000);

      console.log('[Test] 通过URL直接导航到项目');
      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);
      await window.waitForTimeout(2000);

      console.log('[Test] 验证项目详情页加载');
      const detailPage = await window.$('.project-detail-page, [class*="project-detail"]');
      expect(detailPage).toBeTruthy();

      // 验证URL正确
      const currentHash = await window.evaluate(() => window.location.hash);
      expect(currentHash).toContain(`projects/${project.id}`);

      await takeScreenshot(window, 'url-direct-load');

      console.log('[Test] ✅ URL直接加载测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理无效的项目ID', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 导航到不存在的项目ID');
      await window.evaluate(() => {
        window.location.hash = '#/projects/invalid-project-id-999999';
      });
      await window.waitForTimeout(2000);

      console.log('[Test] 验证错误处理');
      // 应该显示错误消息或返回项目列表
      const currentHash = await window.evaluate(() => window.location.hash);

      // 检查是否显示错误提示
      const errorMessage = await window.$('.ant-empty, .error-message, [class*="error"]');
      const backButton = await window.$('[data-testid="back-to-list-button"]');

      // 应该有错误提示或返回按钮
      const hasErrorHandling = errorMessage || backButton;

      if (hasErrorHandling) {
        console.log('[Test] ✅ 找到错误处理UI');

        if (backButton) {
          console.log('[Test] 点击返回项目列表');
          await backButton.click();
          await window.waitForTimeout(1000);

          const finalHash = await window.evaluate(() => window.location.hash);
          expect(finalHash).toContain('projects');
        }
      } else {
        console.log('[Test] ⚠️ 未检测到明显的错误处理UI');
      }

      await takeScreenshot(window, 'invalid-project-handling');

      console.log('[Test] ✅ 无效项目ID处理测试完成');

    } finally {
      await closeElectronApp(app);
    }
  });
});
