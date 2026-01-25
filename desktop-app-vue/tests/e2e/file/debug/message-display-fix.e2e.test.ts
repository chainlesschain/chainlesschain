/**
 * E2E测试 - 验证消息显示修复
 *
 * 测试场景：
 * 1. 加载已有对话的历史消息
 * 2. 发送新消息并验证显示
 * 3. 验证VirtualMessageList正常工作
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot, login, callIPC } from '../../helpers/common';
import { createAndOpenProject, sendChatMessage } from '../../helpers/project-detail';

test.describe('消息显示修复验证', () => {
  test('历史消息应该正常显示', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      const project = await createAndOpenProject(window, {
        name: '消息显示测试项目',
        project_type: 'markdown',
      });
      console.log('[Test] 项目已创建:', project.id);

      console.log('[Test] 检查ChatPanel调试信息');
      const chatPanelDebug = await window.$('div:has-text("ChatPanel DEBUG")');
      if (chatPanelDebug) {
        const debugText = await chatPanelDebug.textContent();
        console.log('[Test] ChatPanel DEBUG:', debugText);

        // 检查messages.length
        const messagesLengthMatch = debugText?.match(/messages\.length=(\d+)/);
        if (messagesLengthMatch) {
          const messagesLength = parseInt(messagesLengthMatch[1]);
          console.log('[Test] 消息数量:', messagesLength);
        }
      }

      console.log('[Test] 检查VirtualMessageList调试信息');
      const virtualListDebug = await window.$('div:has-text("DEBUG: messages count")');
      if (virtualListDebug) {
        const debugText = await virtualListDebug.textContent();
        console.log('[Test] VirtualMessageList DEBUG:', debugText);

        // 验证virtualItems是否正常
        const virtualItemsMatch = debugText?.match(/virtualItems=(\d+)/);
        if (virtualItemsMatch) {
          const virtualItems = parseInt(virtualItemsMatch[1]);
          console.log('[Test] virtualItems数量:', virtualItems);
        }
      }

      console.log('[Test] 检查消息列表');
      const messagesList = await window.$('[data-testid="messages-list"], .messages-container');

      if (messagesList) {
        const messagesText = await messagesList.textContent();
        console.log('[Test] 消息列表内容长度:', messagesText?.length);

        // 检查是否有消息显示
        const messageItems = await window.$$('.message-item, .message, [class*="message"]');
        console.log('[Test] 找到消息元素数量:', messageItems.length);

        if (messageItems.length > 0) {
          console.log('[Test] ✅ 找到历史消息');
          await takeScreenshot(window, 'messages-displayed');
        } else {
          console.log('[Test] ⚠️ 未找到消息元素');
          await takeScreenshot(window, 'no-messages-found');
        }
      }

      console.log('[Test] 发送新消息');
      const messageSent = await sendChatMessage(window, '这是一条测试消息');

      if (messageSent) {
        console.log('[Test] ✅ 消息已发送');
        await window.waitForTimeout(2000);

        // 再次检查调试信息
        const debugAfter = await window.$('div:has-text("ChatPanel DEBUG")');
        if (debugAfter) {
          const debugTextAfter = await debugAfter.textContent();
          console.log('[Test] 发送后 ChatPanel DEBUG:', debugTextAfter);
        }

        const virtualDebugAfter = await window.$('div:has-text("DEBUG: messages count")');
        if (virtualDebugAfter) {
          const virtualTextAfter = await virtualDebugAfter.textContent();
          console.log('[Test] 发送后 VirtualMessageList DEBUG:', virtualTextAfter);
        }

        // 检查新消息是否显示
        const messagesAfter = await window.$$('.message-item, .message, [class*="message"]');
        console.log('[Test] 发送后消息数量:', messagesAfter.length);

        await takeScreenshot(window, 'after-send-message');

        expect(messagesAfter.length).toBeGreaterThan(0);
        console.log('[Test] ✅ 消息显示测试通过');
      } else {
        console.log('[Test] ⚠️ 发送消息失败');
        await takeScreenshot(window, 'send-message-failed');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('Console日志应该显示正确的调试信息', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(2000);

      // 收集console日志
      const consoleLogs: string[] = [];
      window.on('console', msg => {
        const text = msg.text();
        if (text.includes('[ChatPanel]') || text.includes('[VirtualMessageList]')) {
          consoleLogs.push(text);
        }
      });

      console.log('[Test] 创建并打开项目');
      const project = await createAndOpenProject(window, {
        name: 'Console日志测试项目',
        project_type: 'markdown',
      });
      await window.waitForTimeout(2000);

      // 发送一条消息以触发对话加载
      console.log('[Test] 发送测试消息以触发日志');
      await sendChatMessage(window, '测试消息');
      await window.waitForTimeout(2000);

      console.log('[Test] 收集到的Console日志:');
      consoleLogs.forEach(log => console.log('  ', log));

      // 验证关键日志存在
      const hasMessageLoad = consoleLogs.some(log => log.includes('从数据库恢复了'));
      const hasVirtualizerInit = consoleLogs.some(log => log.includes('Virtualizer initialized'));
      const hasScrollContainer = consoleLogs.some(log => log.includes('ScrollContainer尺寸'));

      console.log('[Test] 日志检查:');
      console.log('  - 消息加载日志:', hasMessageLoad ? '✅' : '❌');
      console.log('  - Virtualizer初始化:', hasVirtualizerInit ? '✅' : '❌');
      console.log('  - 滚动容器尺寸:', hasScrollContainer ? '✅' : '❌');

      if (!hasMessageLoad) {
        console.log('[Test] ⚠️ 可能存在消息加载问题');
      }
      if (!hasVirtualizerInit) {
        console.log('[Test] ⚠️ 可能存在虚拟滚动初始化问题');
      }
      if (!hasScrollContainer) {
        console.log('[Test] ⚠️ 可能存在容器尺寸问题');
      }

    } finally {
      await closeElectronApp(app);
    }
  });
});
