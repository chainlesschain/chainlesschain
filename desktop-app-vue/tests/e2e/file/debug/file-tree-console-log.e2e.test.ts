/**
 * Debug测试 - 捕获控制台日志查看Vue响应式链路
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, login, callIPC } from '../../helpers/common';
import {
  createAndOpenProject,
  waitForProjectDetailLoad,
} from '../../helpers/project-detail';

test.describe('Debug: 控制台日志分析', () => {
  test('捕获刷新过程的所有日志', async () => {
    const { app, window } = await launchElectronApp();

    // 收集控制台日志
    const logs: string[] = [];
    window.on('console', msg => {
      const text = msg.text();
      // 只记录与文件树相关的日志
      if (text.includes('[Store]') ||
          text.includes('[ProjectDetail]') ||
          text.includes('[EnhancedFileTree]') ||
          text.includes('[VirtualFileTree]') ||
          text.includes('[FileTree]')) {
        logs.push(`[${new Date().toISOString().split('T')[1].substring(0, 12)}] ${text}`);
        console.log(text); // 同时输出到测试日志
      }
    });

    try {
      console.log('\n======== 测试开始 ========\n');

      // 登录
      await login(window);
      await window.waitForTimeout(1000);

      // 创建项目
      const project = await createAndOpenProject(window, {
        name: '日志测试项目',
        project_type: 'markdown',
      });

      // 等待页面加载
      await waitForProjectDetailLoad(window);
      await window.waitForTimeout(2000);

      console.log('\n======== 初始加载完成，日志如下 ========\n');
      logs.forEach(log => console.log(log));
      logs.length = 0; // 清空

      // 创建新文件
      console.log('\n======== 创建新文件 ========\n');
      await callIPC(window, 'file:createFile', {
        projectId: project.id,
        filePath: 'console-test.md',
        content: '# 控制台测试',
      });

      await window.waitForTimeout(1000);

      console.log('\n======== 点击刷新按钮 ========\n');
      // 点击刷新按钮
      const refreshButton = await window.$('[data-testid="refresh-files-button"]');
      if (refreshButton) {
        await refreshButton.click({ force: true });
      }

      // 等待刷新完成
      await window.waitForTimeout(3000);

      console.log('\n======== 刷新过程的所有日志 ========\n');
      logs.forEach(log => console.log(log));

      // 检查文件是否出现
      const treeContent = await window.textContent('[data-testid="file-tree-container"]');
      const hasFile = treeContent.includes('console-test.md');

      console.log('\n======== 测试结果 ========');
      console.log('文件是否出现:', hasFile ? '✅ 是' : '❌ 否');
      console.log('文件树内容:', treeContent);

    } finally {
      await closeElectronApp(app);
    }
  });
});
