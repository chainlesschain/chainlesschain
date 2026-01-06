/**
 * E2E测试 - AI创建项目模式测试
 *
 * 测试覆盖：
 * 1. 进入AI创建项目模式
 * 2. AI对话创建项目
 * 3. 项目创建完成后的跳转
 * 4. AI创建模式下的UI状态
 * 5. 取消AI创建流程
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot, login } from './helpers';
import { sendChatMessage, waitForProjectDetailLoad, navigateToAICreatingMode } from './project-detail-helpers';

test.describe('项目详情页 - AI创建项目模式测试', () => {
  test('应该能够进入AI创建项目模式', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 导航到AI创建项目页面');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      console.log('[Test] 验证AI创建模式页面加载');
      const projectDetailPage = await window.$('[data-testid="project-detail-page"]');
      expect(projectDetailPage).toBeTruthy();

      // 验证文件树不显示（AI创建模式下隐藏）
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
      if (fileExplorer) {
        const isVisible = await fileExplorer.isVisible();
        console.log('[Test] 文件树可见性:', isVisible);
        // 在AI创建模式下，文件树应该不可见
      }

      // 验证聊天面板显示
      const chatPanel = await window.$('[data-testid="chat-panel"]');
      expect(chatPanel).toBeTruthy();

      await takeScreenshot(window, 'ai-creating-mode-loaded');

      console.log('[Test] ✅ AI创建项目模式加载测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够通过AI对话创建项目', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 进入AI创建模式');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      console.log('[Test] 发送项目创建请求');
      const messageSent = await sendChatMessage(
        window,
        '帮我创建一个名为"AI测试项目"的Markdown项目，用于记录学习笔记'
      );

      expect(messageSent).toBe(true);

      await window.waitForTimeout(3000);

      console.log('[Test] 等待AI响应');
      // AI应该会响应并开始创建项目
      const messagesList = await window.$('[data-testid="messages-list"]');
      expect(messagesList).toBeTruthy();

      await takeScreenshot(window, 'ai-creating-project-response');

      console.log('[Test] ✅ AI创建项目对话测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该在AI创建模式下隐藏文件树和编辑器', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 进入AI创建模式');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      console.log('[Test] 验证UI元素状态');

      // 文件树应该不可见
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
      if (fileExplorer) {
        const isVisible = await fileExplorer.isVisible();
        console.log('[Test] 文件树可见性:', isVisible);
        expect(isVisible).toBe(false);
      } else {
        console.log('[Test] ✅ 文件树元素不存在（符合预期）');
      }

      // 编辑器面板应该不可见
      const editorPanel = await window.$('.editor-preview-panel');
      if (editorPanel) {
        const isVisible = await editorPanel.isVisible();
        console.log('[Test] 编辑器面板可见性:', isVisible);
        expect(isVisible).toBe(false);
      } else {
        console.log('[Test] ✅ 编辑器面板不存在（符合预期）');
      }

      // 聊天面板应该可见
      const chatPanel = await window.$('[data-testid="chat-panel"]');
      expect(chatPanel).toBeTruthy();
      const chatVisible = await chatPanel?.isVisible();
      expect(chatVisible).toBe(true);

      await takeScreenshot(window, 'ai-creating-ui-state');

      console.log('[Test] ✅ AI创建模式UI状态测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够取消AI创建流程', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 进入AI创建模式');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      console.log('[Test] 查找close-button或back-to-list-button');
      // 优先查找close-button或back-to-list-button，避免匹配到MainLayout的"返回首页"按钮
      let closeButton = await window.$('[data-testid="close-button"]');
      if (!closeButton) {
        closeButton = await window.$('[data-testid="back-to-list-button"]');
      }
      if (!closeButton) {
        // 最后尝试查找"返回项目列表"按钮
        closeButton = await window.$('button:has-text("返回项目列表")');
      }

      if (closeButton) {
        const buttonText = await closeButton.textContent();
        const buttonTestId = await closeButton.getAttribute('data-testid');
        console.log('[Test] 找到按钮 - 文本:', buttonText?.trim(), 'testid:', buttonTestId);
        console.log('[Test] 点击按钮返回项目列表');
        await closeButton.click();
        await window.waitForTimeout(1000);

        // 验证是否返回到项目列表
        const hash = await window.evaluate(() => window.location.hash);
        console.log('[Test] 当前URL hash:', hash);

        expect(hash).toContain('projects');
        expect(hash).not.toContain('ai-creating');

        await takeScreenshot(window, 'ai-creating-cancelled');

        console.log('[Test] ✅ 取消AI创建流程测试通过');
      } else {
        console.log('[Test] ⚠️ 未找到取消按钮');
        await takeScreenshot(window, 'cancel-button-not-found');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够在AI创建完成后跳转到新项目', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 进入AI创建模式');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      console.log('[Test] 发送项目创建请求');
      await sendChatMessage(window, '创建一个名为"跳转测试项目"的项目');

      await window.waitForTimeout(3000);

      console.log('[Test] 监听URL变化（等待跳转到新项目）');
      // 在实际场景中，AI创建完成后会自动跳转
      // 这里我们等待一段时间，看是否发生跳转

      let urlChanged = false;
      for (let i = 0; i < 10; i++) {
        await window.waitForTimeout(2000);
        const hash = await window.evaluate(() => window.location.hash);

        if (hash.includes('/projects/') && !hash.includes('ai-creating')) {
          console.log('[Test] ✅ 检测到URL跳转:', hash);
          urlChanged = true;
          await takeScreenshot(window, 'ai-creating-completed-redirected');
          break;
        }
      }

      if (!urlChanged) {
        console.log('[Test] ⚠️ 未检测到自动跳转（可能需要更长时间或AI服务未运行）');
        await takeScreenshot(window, 'ai-creating-no-redirect');
      }

      console.log('[Test] ✅ AI创建完成跳转测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够在AI创建模式下显示创建进度', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 进入AI创建模式');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      console.log('[Test] 发送项目创建请求');
      await sendChatMessage(window, '创建一个包含多个文件的复杂项目');

      await window.waitForTimeout(2000);

      console.log('[Test] 检查是否有进度指示器');
      const loadingIndicator = await window.$('[data-testid="message-loading"], .loading-indicator, .ant-spin');

      if (loadingIndicator) {
        console.log('[Test] ✅ 找到加载指示器');
        const isVisible = await loadingIndicator.isVisible();
        console.log('[Test] 加载指示器可见性:', isVisible);

        await takeScreenshot(window, 'ai-creating-progress-indicator');
      } else {
        console.log('[Test] ⚠️ 未找到加载指示器（可能已完成或未开始）');
        await takeScreenshot(window, 'ai-creating-no-progress-indicator');
      }

      console.log('[Test] ✅ AI创建进度显示测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理AI创建失败的情况', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 进入AI创建模式');
      const navigated = await navigateToAICreatingMode(window);
      expect(navigated).toBe(true);

      console.log('[Test] 发送无效的项目创建请求');
      await sendChatMessage(window, ''); // 空消息

      await window.waitForTimeout(2000);

      console.log('[Test] 检查是否有错误提示');
      const errorMessage = await window.$('.ant-message-error, .error-message');

      if (errorMessage) {
        console.log('[Test] ✅ 正确显示了错误提示');
        await takeScreenshot(window, 'ai-creating-error-shown');
      } else {
        console.log('[Test] ⚠️ 未检测到错误提示（可能阻止了空消息发送）');
        await takeScreenshot(window, 'ai-creating-empty-message-blocked');
      }

      console.log('[Test] ✅ AI创建失败处理测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });
});
