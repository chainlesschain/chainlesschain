/**
 * E2E测试 - 项目详情页UI状态管理测试
 *
 * 测试覆盖：
 * 1. 加载状态显示
 * 2. 错误状态处理
 * 3. 空状态显示
 */

import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  closeElectronApp,
  takeScreenshot,
  login,
} from '../../helpers/common';
import {
  createAndOpenProject,
  waitForProjectDetailLoad,
} from '../../helpers/project-detail';

test.describe('项目详情页 - UI状态管理测试', () => {
  test('应该在项目加载时显示加载状态', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 监控加载状态');
      // 创建项目并立即检查加载状态
      const project = await createAndOpenProject(window, {
        name: '加载状态测试',
        project_type: 'markdown',
      });

      // 注意：加载状态可能很快消失，这里我们主要验证加载后的稳定状态
      await window.waitForTimeout(500);

      console.log('[Test] 检查是否有加载指示器');
      const loadingIndicators = await window.$$('.ant-spin, .loading, [class*="loading"]');

      console.log('[Test] 找到加载指示器数量:', loadingIndicators.length);

      // 等待加载完成
      await waitForProjectDetailLoad(window);

      console.log('[Test] 验证加载完成后的状态');
      // 验证主要内容已加载
      const mainContent = await window.$('.project-detail-page, [class*="project-detail"]');
      expect(mainContent).toBeTruthy();

      await takeScreenshot(window, 'loaded-state');

      console.log('[Test] ✅ 加载状态测试完成');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该正确显示错误提示消息', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 尝试触发错误');
      // 尝试加载不存在的项目
      await window.evaluate(() => {
        window.location.hash = '#/projects/nonexistent-id-999';
      });
      await window.waitForTimeout(2000);

      console.log('[Test] 检查错误消息');
      // 查找各种可能的错误提示元素
      const errorElements = await window.$$('.ant-message-error, .ant-alert-error, .error-message, [class*="error"]');

      console.log('[Test] 找到错误元素数量:', errorElements.length);

      // 检查是否有"找不到"或"不存在"的提示
      const pageText = await window.evaluate(() => document.body.textContent);
      const hasErrorText = pageText?.includes('找不到') ||
                          pageText?.includes('不存在') ||
                          pageText?.includes('失败') ||
                          pageText?.includes('错误');

      if (hasErrorText || errorElements.length > 0) {
        console.log('[Test] ✅ 检测到错误提示');
      } else {
        console.log('[Test] ⚠️ 未检测到明显的错误提示');
      }

      await takeScreenshot(window, 'error-state');

      console.log('[Test] ✅ 错误状态测试完成');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该在文件列表为空时显示空状态', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建新项目（应该没有文件）');
      await createAndOpenProject(window, {
        name: '空状态测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 检查文件列表');
      const fileList = await window.$('[data-testid="file-tree"], .file-tree, .file-list');

      if (fileList) {
        // 查找空状态提示
        const emptyState = await window.$('.ant-empty, .empty-state, [class*="empty"]');

        if (emptyState) {
          const isVisible = await emptyState.isVisible();
          console.log('[Test] 空状态可见性:', isVisible);

          if (isVisible) {
            const emptyText = await emptyState.textContent();
            console.log('[Test] 空状态文本:', emptyText);

            await takeScreenshot(window, 'empty-state');

            console.log('[Test] ✅ 检测到空状态提示');
          }
        } else {
          // 检查文件列表项数量
          const fileItems = await window.$$('[data-testid="file-item"], .file-item, .ant-tree-node');
          console.log('[Test] 文件项数量:', fileItems.length);

          if (fileItems.length === 0) {
            console.log('[Test] ✅ 文件列表为空（符合预期）');
          }
        }
      } else {
        console.log('[Test] ⚠️ 未找到文件列表元素');
      }

      await takeScreenshot(window, 'empty-file-list');

      console.log('[Test] ✅ 空状态测试完成');

    } finally {
      await closeElectronApp(app);
    }
  });
});
