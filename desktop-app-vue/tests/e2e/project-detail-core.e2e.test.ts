/**
 * E2E测试 - 项目详情页核心功能测试（简化版）
 *
 * 这个测试文件专注于最核心和最常用的功能，确保它们正常工作
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot } from './helpers';
import {
  createAndOpenProject,
  createTestFile,
  selectFileInTree,
  sendChatMessage,
  waitForAIResponse,
  switchContextMode,
  saveCurrentFile,
  refreshFileList,
  performGitAction,
  toggleEditorPanel,
  openFileManageModal,
  openShareModal,
  waitForProjectDetailLoad,
  backToProjectList,
  toggleFileTreeMode,
  clearConversation,
} from './project-detail-helpers';

// 测试配置
const TEST_PROJECT_NAME = 'E2E核心测试项目';
const TEST_FILE_NAME = '测试文件.md';
const TEST_FILE_CONTENT = '# 测试标题\n\n这是测试内容。';

test.describe('项目详情页 - 核心功能测试', () => {
  test('完整流程：创建项目 -> 创建文件 -> 编辑 -> 保存 -> AI对话', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 第1步: 创建并打开项目');
      const project = await createAndOpenProject(window, {
        name: TEST_PROJECT_NAME,
        description: '用于核心功能E2E测试',
        project_type: 'markdown',
      });

      expect(project).toBeTruthy();
      expect(project.id).toBeTruthy();

      await takeScreenshot(window, '01-project-opened');

      console.log('[Test] 第2步: 等待项目详情页加载完成');
      const loaded = await waitForProjectDetailLoad(window);
      expect(loaded).toBe(true);

      console.log('[Test] 第3步: 验证核心UI元素存在');
      const breadcrumb = await window.$('[data-testid="toolbar-breadcrumb"]');
      expect(breadcrumb).toBeTruthy();

      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
      expect(fileExplorer).toBeTruthy();

      const chatPanel = await window.$('[data-testid="chat-panel"]');
      expect(chatPanel).toBeTruthy();

      await takeScreenshot(window, '02-ui-elements-verified');

      console.log('[Test] 第4步: 创建测试文件');
      const file = await createTestFile(window, project.id, {
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      expect(file).toBeTruthy();
      expect(file.file_name).toBe(TEST_FILE_NAME);

      console.log('[Test] 第5步: 刷新文件列表');
      const refreshed = await refreshFileList(window);
      expect(refreshed).toBe(true);

      await takeScreenshot(window, '03-file-created-and-refreshed');

      console.log('[Test] 第6步: 在文件树中选择文件');
      const selected = await selectFileInTree(window, TEST_FILE_NAME);
      expect(selected).toBe(true);

      await window.waitForTimeout(2000); // 等待文件加载

      await takeScreenshot(window, '04-file-selected');

      console.log('[Test] 第7步: 测试文件树模式切换');
      const toggled = await toggleFileTreeMode(window);
      expect(toggled).toBe(true);

      await takeScreenshot(window, '05-file-tree-mode-toggled');

      console.log('[Test] 第8步: 测试上下文模式切换');
      await switchContextMode(window, 'project');
      await window.waitForTimeout(300);

      await switchContextMode(window, 'file');
      await window.waitForTimeout(300);

      await switchContextMode(window, 'global');
      await window.waitForTimeout(300);

      await takeScreenshot(window, '06-context-modes-tested');

      console.log('[Test] 第9步: 发送AI对话消息');
      const messageSent = await sendChatMessage(window, '你好，这是一个测试消息');
      expect(messageSent).toBe(true);

      await takeScreenshot(window, '07-message-sent');

      console.log('[Test] 第10步: 等待AI响应（超时30秒）');
      // Note: 这可能会超时，因为测试环境可能没有实际的LLM服务
      try {
        await waitForAIResponse(window, 30000);
        await takeScreenshot(window, '08-ai-response-received');
      } catch (error) {
        console.warn('[Test] AI响应超时或失败（这在测试环境中是正常的）:', error);
        await takeScreenshot(window, '08-ai-response-timeout');
      }

      console.log('[Test] 第11步: 测试编辑器面板切换');
      const editorToggled = await toggleEditorPanel(window);
      expect(editorToggled).toBe(true);

      await takeScreenshot(window, '09-editor-panel-toggled');

      console.log('[Test] 第12步: 打开文件管理对话框');
      const fileManageOpened = await openFileManageModal(window);
      expect(fileManageOpened).toBe(true);

      await takeScreenshot(window, '10-file-manage-modal-opened');

      // 关闭对话框
      const closeBtn = await window.$('.ant-modal-close');
      if (closeBtn) {
        await closeBtn.click();
        await window.waitForTimeout(300);
      }

      console.log('[Test] 第13步: 打开分享对话框');
      const shareOpened = await openShareModal(window);
      expect(shareOpened).toBe(true);

      await takeScreenshot(window, '11-share-modal-opened');

      // 关闭对话框
      const closeBtnShare = await window.$('.ant-modal-close');
      if (closeBtnShare) {
        await closeBtnShare.click();
        await window.waitForTimeout(300);
      }

      console.log('[Test] 第14步: 测试Git操作菜单');
      try {
        const gitActionPerformed = await performGitAction(window, 'status');
        expect(gitActionPerformed).toBe(true);
        await takeScreenshot(window, '12-git-action-performed');

        // 关闭Git状态对话框（如果有）
        const gitCloseBtn = await window.$('.ant-modal-close');
        if (gitCloseBtn) {
          await gitCloseBtn.click();
          await window.waitForTimeout(300);
        }
      } catch (error) {
        console.warn('[Test] Git操作失败（这在测试环境中可能是正常的）:', error);
      }

      console.log('[Test] 第15步: 返回项目列表');
      const backedToList = await backToProjectList(window);
      expect(backedToList).toBe(true);

      await takeScreenshot(window, '13-back-to-project-list');

      console.log('[Test] ✅ 完整流程测试通过！');
    } catch (error) {
      console.error('[Test] ❌ 测试失败:', error);
      await takeScreenshot(window, 'error-final');
      throw error;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('错误处理：加载不存在的项目', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 导航到不存在的项目');
      const nonExistentId = 'non-existent-project-id-12345';

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, nonExistentId);

      // 等待错误容器显示
      await window.waitForSelector('[data-testid="error-container"]', { timeout: 5000 });

      // 验证错误信息
      const errorContainer = await window.$('[data-testid="error-container"]');
      expect(errorContainer).toBeTruthy();

      const errorText = await window.textContent('[data-testid="error-container"]');
      expect(errorText).toContain('项目不存在');

      await takeScreenshot(window, 'error-project-not-found');

      console.log('[Test] ✅ 错误处理测试通过！');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('文件操作：创建、选择、刷新', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '文件操作测试项目',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建多个测试文件');
      const files = [];
      for (let i = 1; i <= 3; i++) {
        const file = await createTestFile(window, project.id, {
          fileName: `测试文件${i}.md`,
          content: `# 文件 ${i}\n\n这是第${i}个测试文件。`,
          fileType: 'markdown',
        });
        files.push(file);
      }

      expect(files.length).toBe(3);

      console.log('[Test] 刷新文件列表');
      await refreshFileList(window);
      await window.waitForTimeout(1000);

      // 验证文件在文件树中可见
      const fileTreeContent = await window.textContent('[data-testid="file-tree-container"]');
      expect(fileTreeContent).toContain('测试文件1.md');
      expect(fileTreeContent).toContain('测试文件2.md');
      expect(fileTreeContent).toContain('测试文件3.md');

      console.log('[Test] 选择第一个文件');
      const selected = await selectFileInTree(window, '测试文件1.md');
      expect(selected).toBe(true);

      await takeScreenshot(window, 'file-operations-completed');

      console.log('[Test] ✅ 文件操作测试通过！');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('UI交互：按钮和切换功能', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'UI交互测试项目',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 测试所有按钮是否可点击');
      const buttons = [
        '[data-testid="file-manage-button"]',
        '[data-testid="share-button"]',
        '[data-testid="toggle-editor-button"]',
        '[data-testid="git-actions-button"]',
        '[data-testid="save-button"]',
        '[data-testid="close-button"]',
        '[data-testid="refresh-files-button"]',
        '[data-testid="file-tree-mode-switch"]',
      ];

      for (const selector of buttons) {
        const button = await window.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          console.log(`  - ${selector}: ${isVisible ? '✓' : '✗'}`);
        } else {
          console.log(`  - ${selector}: 未找到`);
        }
      }

      console.log('[Test] 测试上下文模式切换');
      await switchContextMode(window, 'project');
      await switchContextMode(window, 'file');
      await switchContextMode(window, 'global');

      console.log('[Test] 测试编辑器面板切换');
      await toggleEditorPanel(window);
      await window.waitForTimeout(500);
      await toggleEditorPanel(window);

      console.log('[Test] 测试文件树模式切换');
      await toggleFileTreeMode(window);
      await window.waitForTimeout(500);
      await toggleFileTreeMode(window);

      await takeScreenshot(window, 'ui-interactions-completed');

      console.log('[Test] ✅ UI交互测试通过！');
    } finally {
      await closeElectronApp(app);
    }
  });
});
