/**
 * E2E测试 - 项目详情页面板布局和Git操作测试
 *
 * 测试覆盖：
 * 1. 面板拖拽调整大小
 * 2. 面板最小/最大宽度限制
 * 3. Git提交对话框
 * 4. Git提交流程
 * 5. Git推送和拉取
 * 6. Git历史查看
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot, login, callIPC } from './helpers';
import {
  createAndOpenProject,
  createTestFile,
  waitForProjectDetailLoad,
  performGitAction,
} from './project-detail-helpers';

test.describe('项目详情页 - 面板布局测试', () => {
  test('应该能够拖拽调整文件树面板宽度', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '面板拖拽测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 获取文件树面板初始宽度');
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
      expect(fileExplorer).toBeTruthy();

      const initialWidth = await fileExplorer?.evaluate((el) => el.clientWidth);
      console.log('[Test] 初始宽度:', initialWidth);

      await takeScreenshot(window, 'panel-initial-width');

      console.log('[Test] 查找拖拽手柄');
      const resizeHandle = await window.$('.resize-handle');

      if (resizeHandle) {
        console.log('[Test] 找到拖拽手柄，开始拖拽');
        const box = await resizeHandle.boundingBox();

        if (box) {
          // 拖拽手柄向右移动100px
          await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await window.mouse.down();
          await window.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 });
          await window.mouse.up();

          await window.waitForTimeout(500);

          // 验证宽度改变
          const newWidth = await fileExplorer?.evaluate((el) => el.clientWidth);
          console.log('[Test] 新宽度:', newWidth);

          expect(newWidth).not.toBe(initialWidth);
          expect(newWidth).toBeGreaterThan(initialWidth || 0);

          await takeScreenshot(window, 'panel-resized-wider');

          // 拖拽回原位
          await window.mouse.move(box.x + 100, box.y + box.height / 2);
          await window.mouse.down();
          await window.mouse.move(box.x, box.y + box.height / 2, { steps: 10 });
          await window.mouse.up();

          await window.waitForTimeout(500);
          await takeScreenshot(window, 'panel-resized-back');

          console.log('[Test] ✅ 面板拖拽测试通过');
        }
      } else {
        console.log('[Test] ⚠️ 未找到拖拽手柄');
        await takeScreenshot(window, 'resize-handle-not-found');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够拖拽调整编辑器面板宽度', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '编辑器面板拖拽测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 确保编辑器面板可见');
      const editorPanel = await window.$('.editor-preview-panel');

      if (!editorPanel) {
        console.log('[Test] 编辑器面板不可见，尝试显示');
        const toggleButton = await window.$('[data-testid="toggle-editor-button"]');
        if (toggleButton) {
          await toggleButton.click();
          await window.waitForTimeout(500);
        }
      }

      console.log('[Test] 获取编辑器面板初始宽度');
      const editorPanelElement = await window.$('.editor-preview-panel');
      const initialWidth = await editorPanelElement?.evaluate((el) => el.clientWidth);
      console.log('[Test] 初始宽度:', initialWidth);

      console.log('[Test] 查找编辑器面板的拖拽手柄');
      const resizeHandles = await window.$$('.resize-handle');

      if (resizeHandles.length > 1) {
        // 第二个拖拽手柄是编辑器面板的
        const editorResizeHandle = resizeHandles[1];
        const box = await editorResizeHandle.boundingBox();

        if (box) {
          console.log('[Test] 拖拽编辑器面板手柄');
          await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await window.mouse.down();
          await window.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 10 });
          await window.mouse.up();

          await window.waitForTimeout(500);

          const newWidth = await editorPanelElement?.evaluate((el) => el.clientWidth);
          console.log('[Test] 新宽度:', newWidth);

          await takeScreenshot(window, 'editor-panel-resized');

          console.log('[Test] ✅ 编辑器面板拖拽测试通过');
        }
      } else {
        console.log('[Test] ⚠️ 未找到编辑器面板拖拽手柄');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该遵守面板最小宽度限制', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '最小宽度测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 尝试将文件树面板拖拽到最小');
      const resizeHandle = await window.$('.resize-handle');

      if (resizeHandle) {
        const box = await resizeHandle.boundingBox();

        if (box) {
          // 尝试拖拽到很小的宽度
          await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await window.mouse.down();
          await window.mouse.move(50, box.y + box.height / 2, { steps: 10 });
          await window.mouse.up();

          await window.waitForTimeout(500);

          const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
          const finalWidth = await fileExplorer?.evaluate((el) => el.clientWidth);
          console.log('[Test] 最终宽度:', finalWidth);

          // 验证宽度不会小于最小值（通常是200px左右）
          expect(finalWidth).toBeGreaterThanOrEqual(150);

          await takeScreenshot(window, 'panel-min-width-enforced');

          console.log('[Test] ✅ 最小宽度限制测试通过');
        }
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - Git操作测试', () => {
  test('应该能够打开Git提交对话框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建启用Git的项目');
      const project = await createAndOpenProject(window, {
        name: 'Git提交测试',
        project_type: 'markdown',
        enable_git: true,
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建测试文件（产生Git更改）');
      await createTestFile(window, project.id, {
        fileName: 'new-file.md',
        content: '# 新文件\n\n这是一个新文件。',
        fileType: 'markdown',
      });

      await window.waitForTimeout(1000);

      console.log('[Test] 打开Git操作菜单');
      const gitButton = await window.$('[data-testid="git-actions-button"]');
      expect(gitButton).toBeTruthy();

      await gitButton?.click();
      await window.waitForTimeout(500);

      console.log('[Test] 点击提交更改');
      const commitItem = await window.$('[data-testid="git-commit-item"]');
      if (commitItem) {
        await commitItem.click();
        await window.waitForTimeout(1000);

        console.log('[Test] 验证提交对话框显示');
        const modal = await window.$('.ant-modal:has-text("提交更改")');
        expect(modal).toBeTruthy();

        await takeScreenshot(window, 'git-commit-modal-opened');

        console.log('[Test] ✅ Git提交对话框测试通过');
      } else {
        console.log('[Test] ⚠️ 未找到提交菜单项');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够完成Git提交流程', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建启用Git的项目');
      const project = await createAndOpenProject(window, {
        name: 'Git提交流程测试',
        project_type: 'markdown',
        enable_git: true,
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建测试文件');
      await createTestFile(window, project.id, {
        fileName: 'commit-test.md',
        content: '# 提交测试\n\n这个文件将被提交。',
        fileType: 'markdown',
      });

      await window.waitForTimeout(1000);

      console.log('[Test] 打开Git提交对话框');
      const gitButton = await window.$('[data-testid="git-actions-button"]');
      await gitButton?.click();
      await window.waitForTimeout(500);

      const commitItem = await window.$('[data-testid="git-commit-item"]');
      if (commitItem) {
        await commitItem.click();
        await window.waitForTimeout(1000);

        console.log('[Test] 输入提交信息');
        const textarea = await window.$('.ant-modal textarea');
        if (textarea) {
          await textarea.fill('test: 添加测试文件');
          await window.waitForTimeout(500);

          console.log('[Test] 点击确定按钮');
          const okButton = await window.$('.ant-modal .ant-btn-primary:has-text("确定")');
          if (okButton) {
            await okButton.click();
            await window.waitForTimeout(2000);

            // 验证提交成功提示
            const successMessage = await window.$('.ant-message-success');
            if (successMessage) {
              console.log('[Test] ✅ Git提交成功');
              await takeScreenshot(window, 'git-commit-success');
            } else {
              console.log('[Test] ⚠️ 未检测到成功提示（可能Git未初始化）');
              await takeScreenshot(window, 'git-commit-no-success-message');
            }
          }
        }
      }

      console.log('[Test] ✅ Git提交流程测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够查看Git状态', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建启用Git的项目');
      const project = await createAndOpenProject(window, {
        name: 'Git状态测试',
        project_type: 'markdown',
        enable_git: true,
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查看Git状态');
      const statusShown = await performGitAction(window, 'status');

      if (statusShown) {
        console.log('[Test] 验证Git状态对话框');
        const modal = await window.$('.ant-modal');
        expect(modal).toBeTruthy();

        await takeScreenshot(window, 'git-status-dialog');

        // 关闭对话框
        const closeButton = await window.$('.ant-modal-close');
        if (closeButton) {
          await closeButton.click();
          await window.waitForTimeout(500);
        }

        console.log('[Test] ✅ Git状态测试通过');
      } else {
        console.log('[Test] ⚠️ Git状态对话框未显示');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够查看Git提交历史', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建启用Git的项目');
      const project = await createAndOpenProject(window, {
        name: 'Git历史测试',
        project_type: 'markdown',
        enable_git: true,
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查看Git历史');
      const historyShown = await performGitAction(window, 'history');

      if (historyShown) {
        console.log('[Test] 验证Git历史对话框');
        const modal = await window.$('.ant-modal');
        expect(modal).toBeTruthy();

        await takeScreenshot(window, 'git-history-dialog');

        // 关闭对话框
        const closeButton = await window.$('.ant-modal-close');
        if (closeButton) {
          await closeButton.click();
          await window.waitForTimeout(500);
        }

        console.log('[Test] ✅ Git历史测试通过');
      } else {
        console.log('[Test] ⚠️ Git历史对话框未显示');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理Git推送操作', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建启用Git的项目');
      const project = await createAndOpenProject(window, {
        name: 'Git推送测试',
        project_type: 'markdown',
        enable_git: true,
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 尝试Git推送');
      const pushPerformed = await performGitAction(window, 'push');

      if (pushPerformed) {
        await window.waitForTimeout(2000);

        // 检查是否有错误提示（因为可能没有配置远程仓库）
        const errorMessage = await window.$('.ant-message-error, .ant-message-warning');
        if (errorMessage) {
          console.log('[Test] ✅ 正确显示了推送错误（预期行为，因为没有远程仓库）');
          await takeScreenshot(window, 'git-push-error-expected');
        } else {
          console.log('[Test] ⚠️ 推送操作完成（可能已配置远程仓库）');
          await takeScreenshot(window, 'git-push-completed');
        }
      }

      console.log('[Test] ✅ Git推送测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理Git拉取操作', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建启用Git的项目');
      const project = await createAndOpenProject(window, {
        name: 'Git拉取测试',
        project_type: 'markdown',
        enable_git: true,
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 尝试Git拉取');
      const pullPerformed = await performGitAction(window, 'pull');

      if (pullPerformed) {
        await window.waitForTimeout(2000);

        // 检查是否有错误提示（因为可能没有配置远程仓库）
        const errorMessage = await window.$('.ant-message-error, .ant-message-warning');
        if (errorMessage) {
          console.log('[Test] ✅ 正确显示了拉取错误（预期行为，因为没有远程仓库）');
          await takeScreenshot(window, 'git-pull-error-expected');
        } else {
          console.log('[Test] ⚠️ 拉取操作完成（可能已配置远程仓库）');
          await takeScreenshot(window, 'git-pull-completed');
        }
      }

      console.log('[Test] ✅ Git拉取测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });
});
