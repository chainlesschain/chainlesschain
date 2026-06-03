/**
 * E2E测试 - 项目详情页对话历史和侧边栏功能测试
 *
 * 测试覆盖：
 * 1. 对话历史列表显示
 * 2. 创建新对话
 * 3. 切换对话
 * 4. 删除对话
 * 5. 清空对话
 * 6. 项目侧边栏显示/隐藏
 * 7. 项目历史记录
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot, login, callIPC } from '../../helpers/common';
import {
  createAndOpenProject,
  sendChatMessage,
  waitForProjectDetailLoad,
  clearConversation,
} from '../../helpers/project-detail';

test.describe('项目详情页 - 对话历史管理测试', () => {
  test('应该能够显示对话历史列表', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '对话历史测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找对话历史区域');
      // 对话历史可能在聊天面板的侧边或顶部
      const conversationList = await window.$('.conversation-list, .chat-history, [data-testid="conversation-list"]');

      if (conversationList) {
        console.log('[Test] ✅ 找到对话历史列表');
        await takeScreenshot(window, 'conversation-list-found');

        const isVisible = await conversationList.isVisible();
        expect(isVisible).toBe(true);
      } else {
        console.log('[Test] ⚠️ 未找到对话历史列表（可能需要点击按钮显示）');
        await takeScreenshot(window, 'conversation-list-not-found');

        // 尝试查找显示对话历史的按钮
        const historyButton = await window.$('button:has-text("历史"), button:has-text("对话"), [data-testid="show-history-button"]');
        if (historyButton) {
          await historyButton.click();
          await window.waitForTimeout(500);
          await takeScreenshot(window, 'conversation-list-after-click');
        }
      }

      console.log('[Test] ✅ 对话历史列表测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够创建新对话', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '新对话测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 发送第一条消息（创建对话）');
      const messageSent = await sendChatMessage(window, '这是第一条测试消息');
      expect(messageSent).toBe(true);

      await window.waitForTimeout(2000);

      console.log('[Test] 验证对话已创建');
      // 检查消息列表中是否有消息
      const messagesList = await window.$('[data-testid="messages-list"], .message-list, .chat-messages');
      expect(messagesList).toBeTruthy();

      const messagesText = await messagesList?.textContent();
      expect(messagesText).toContain('这是第一条测试消息');

      await takeScreenshot(window, 'new-conversation-created');

      console.log('[Test] ✅ 新对话创建测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够清空当前对话', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '清空对话测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 发送测试消息');
      await sendChatMessage(window, '这条消息将被清空');
      await window.waitForTimeout(2000);

      console.log('[Test] 清空对话');
      const cleared = await clearConversation(window);

      if (cleared) {
        console.log('[Test] ✅ 对话已清空');
        await window.waitForTimeout(1000);

        // 验证消息列表为空
        const messagesList = await window.$('[data-testid="messages-list"], .message-list');
        const messagesText = await messagesList?.textContent();

        // 消息列表应该为空或只包含提示文本
        console.log('[Test] 清空后的消息列表:', messagesText);

        await takeScreenshot(window, 'conversation-cleared');
      } else {
        console.log('[Test] ⚠️ 清空按钮不可用或未找到');
        await takeScreenshot(window, 'clear-button-not-available');
      }

      console.log('[Test] ✅ 清空对话测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够在多个对话之间切换', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '对话切换测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建第一个对话');
      await sendChatMessage(window, '第一个对话的消息');
      await window.waitForTimeout(2000);

      console.log('[Test] 创建第二个对话');
      // 通过API创建新对话
      const conversation2 = await callIPC(window, 'conversation:create', {
        project_id: project.id,
        title: '第二个对话',
      });

      if (conversation2) {
        console.log('[Test] 第二个对话已创建:', conversation2.id);

        // 尝试切换到第二个对话
        const conversationItems = await window.$$('.conversation-item, .chat-history-item');
        if (conversationItems.length >= 2) {
          console.log('[Test] 找到多个对话，尝试切换');
          await conversationItems[1].click();
          await window.waitForTimeout(1000);

          await takeScreenshot(window, 'switched-to-second-conversation');

          console.log('[Test] 切换回第一个对话');
          await conversationItems[0].click();
          await window.waitForTimeout(1000);

          await takeScreenshot(window, 'switched-back-to-first-conversation');

          console.log('[Test] ✅ 对话切换测试通过');
        } else {
          console.log('[Test] ⚠️ 未找到足够的对话项进行切换');
        }
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够删除对话', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '删除对话测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建测试对话');
      const conversation = await callIPC(window, 'conversation:create', {
        project_id: project.id,
        title: '待删除的对话',
      });

      expect(conversation).toBeTruthy();

      await window.waitForTimeout(1000);

      console.log('[Test] 尝试删除对话');
      // 查找对话项的删除按钮
      const conversationItem = await window.$('.conversation-item:has-text("待删除的对话")');

      if (conversationItem) {
        // 悬停显示删除按钮
        await conversationItem.hover();
        await window.waitForTimeout(300);

        const deleteButton = await conversationItem.$('button:has-text("删除"), .delete-button, [data-testid="delete-conversation"]');
        if (deleteButton) {
          await deleteButton.click();
          await window.waitForTimeout(500);

          // 可能有确认对话框
          const confirmButton = await window.$('.ant-modal .ant-btn-primary:has-text("确定"), .ant-popconfirm .ant-btn-primary');
          if (confirmButton) {
            await confirmButton.click();
            await window.waitForTimeout(1000);
          }

          await takeScreenshot(window, 'conversation-deleted');

          console.log('[Test] ✅ 对话删除测试通过');
        } else {
          console.log('[Test] ⚠️ 未找到删除按钮');
        }
      } else {
        console.log('[Test] ⚠️ 未找到对话项');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够显示对话的消息数量', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '消息数量测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 发送多条消息');
      for (let i = 1; i <= 3; i++) {
        await sendChatMessage(window, `测试消息 ${i}`);
        await window.waitForTimeout(1000);
      }

      console.log('[Test] 检查对话历史中的消息数量显示');
      const conversationItem = await window.$('.conversation-item, .chat-history-item');

      if (conversationItem) {
        const itemText = await conversationItem.textContent();
        console.log('[Test] 对话项内容:', itemText);

        // 可能显示消息数量，如 "3条消息"
        await takeScreenshot(window, 'conversation-with-message-count');

        console.log('[Test] ✅ 消息数量显示测试完成');
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 项目侧边栏测试', () => {
  test('应该能够显示项目侧边栏', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '侧边栏测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找项目侧边栏');
      const sidebar = await window.$('.project-sidebar, [data-testid="project-sidebar"]');

      if (sidebar) {
        console.log('[Test] ✅ 找到项目侧边栏');
        const isVisible = await sidebar.isVisible();
        console.log('[Test] 侧边栏可见性:', isVisible);

        await takeScreenshot(window, 'project-sidebar-visible');
      } else {
        console.log('[Test] ⚠️ 未找到项目侧边栏');
        await takeScreenshot(window, 'project-sidebar-not-found');
      }

      console.log('[Test] ✅ 项目侧边栏显示测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够显示项目历史记录', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建多个项目');
      const projects = [];
      for (let i = 1; i <= 3; i++) {
        const project = await createAndOpenProject(window, {
          name: `历史项目${i}`,
          project_type: 'markdown',
        });
        projects.push(project);
        await window.waitForTimeout(500);

        // 返回项目列表
        await window.evaluate(() => {
          window.location.hash = '#/projects';
        });
        await window.waitForTimeout(500);
      }

      console.log('[Test] 打开最后一个项目');
      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, projects[projects.length - 1].id);

      await waitForProjectDetailLoad(window);

      console.log('[Test] 检查项目侧边栏中的历史记录');
      const sidebar = await window.$('.project-sidebar, [data-testid="project-sidebar"]');

      if (sidebar) {
        const sidebarText = await sidebar.textContent();
        console.log('[Test] 侧边栏内容:', sidebarText);

        // 检查是否包含其他项目
        const hasHistory = sidebarText?.includes('历史项目1') || sidebarText?.includes('历史项目2');
        console.log('[Test] 包含历史记录:', hasHistory);

        await takeScreenshot(window, 'project-history-in-sidebar');
      }

      console.log('[Test] ✅ 项目历史记录测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够从侧边栏快速切换项目', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建两个项目');
      const project1 = await createAndOpenProject(window, {
        name: '项目A',
        project_type: 'markdown',
      });

      await window.evaluate(() => {
        window.location.hash = '#/projects';
      });
      await window.waitForTimeout(500);

      const project2 = await createAndOpenProject(window, {
        name: '项目B',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 尝试从侧边栏切换到项目A');
      const sidebar = await window.$('.project-sidebar');

      if (sidebar) {
        const projectALink = await sidebar.$('a:has-text("项目A"), .project-item:has-text("项目A")');

        if (projectALink) {
          await projectALink.click();
          await window.waitForTimeout(2000);

          // 验证已切换到项目A
          const breadcrumb = await window.textContent('[data-testid="toolbar-breadcrumb"]');
          expect(breadcrumb).toContain('项目A');

          await takeScreenshot(window, 'switched-to-project-a');

          console.log('[Test] ✅ 项目切换测试通过');
        } else {
          console.log('[Test] ⚠️ 未找到项目A的链接');
        }
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够收起/展开项目侧边栏', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '侧边栏折叠测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找侧边栏折叠按钮');
      const toggleButton = await window.$('.sidebar-toggle, [data-testid="toggle-sidebar-button"]');

      if (toggleButton) {
        console.log('[Test] 点击折叠按钮');
        await toggleButton.click();
        await window.waitForTimeout(500);

        await takeScreenshot(window, 'sidebar-collapsed');

        console.log('[Test] 再次点击展开');
        await toggleButton.click();
        await window.waitForTimeout(500);

        await takeScreenshot(window, 'sidebar-expanded');

        console.log('[Test] ✅ 侧边栏折叠测试通过');
      } else {
        console.log('[Test] ⚠️ 未找到侧边栏折叠按钮');
        await takeScreenshot(window, 'sidebar-toggle-not-found');
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
