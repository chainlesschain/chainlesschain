/**
 * Debug测试 - 文件树UI刷新验证
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, login, callIPC } from '../../helpers/common';
import {
  createAndOpenProject,
  waitForProjectDetailLoad,
  refreshFileList
} from '../../helpers/project-detail';

test.describe('Debug: 文件树UI刷新', () => {
  test('创建文件后UI刷新测试', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 登录
      console.log('[Debug] 步骤1: 登录');
      await login(window);
      await window.waitForTimeout(1000);

      // 创建项目
      console.log('[Debug] 步骤2: 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'UI刷新测试',
        description: 'UI刷新测试项目',
        project_type: 'markdown',
      });

      // 等待项目详情页加载
      await waitForProjectDetailLoad(window);

      // 获取初始UI文件树内容
      console.log('[Debug] 步骤3: 检查初始文件树UI');
      let treeContent = await window.textContent('[data-testid="file-tree-container"]');
      console.log('[Debug] 初始文件树内容:', treeContent);

      // 创建物理文件
      console.log('[Debug] 步骤4: 创建新文件');
      await callIPC(window, 'file:createFile', {
        projectId: project.id,
        filePath: 'ui-test.md',
        content: '# UI测试\n\n这是UI刷新测试。',
      });

      // 等待文件创建事件传播
      await window.waitForTimeout(1000);

      // 检查文件树UI（不刷新）
      console.log('[Debug] 步骤5: 创建后检查文件树（不刷新）');
      treeContent = await window.textContent('[data-testid="file-tree-container"]');
      console.log('[Debug] 创建后文件树内容（不刷新）:', treeContent);
      const hasFileBeforeRefresh = treeContent.includes('ui-test.md');
      console.log('[Debug] 文件是否自动出现:', hasFileBeforeRefresh ? '✅ 是' : '❌ 否');

      // 点击刷新按钮
      console.log('[Debug] 步骤6: 点击刷新按钮');
      const refreshed = await refreshFileList(window);
      console.log('[Debug] 刷新结果:', refreshed);

      // 再次检查文件树UI
      console.log('[Debug] 步骤7: 刷新后检查文件树');
      await window.waitForTimeout(2000); // 等待UI更新
      treeContent = await window.textContent('[data-testid="file-tree-container"]');
      console.log('[Debug] 刷新后文件树内容:', treeContent);
      const hasFileAfterRefresh = treeContent.includes('ui-test.md');
      console.log('[Debug] 文件是否出现:', hasFileAfterRefresh ? '✅ 是' : '❌ 否');

      // 通过evaluate获取Vue组件状态
      console.log('[Debug] 步骤8: 检查Vue组件状态');
      const vueState = await window.evaluate(() => {
        // 尝试访问Vue devtools或组件实例
        return {
          hasVueDevtools: typeof window.__VUE_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined',
          fileTreeHTML: document.querySelector('[data-testid="file-tree-container"]')?.innerHTML.substring(0, 500),
        };
      });
      console.log('[Debug] Vue状态:', vueState);

      // 验证
      if (!hasFileAfterRefresh) {
        console.error('[Debug] ❌ BUG确认：刷新后文件仍未出现在UI中！');
        console.error('[Debug] 但我们知道文件在物理层面和IPC层面都存在');
        console.error('[Debug] 这说明问题在Vue组件的响应式更新');
      } else {
        console.log('[Debug] ✅ 文件树刷新正常工作');
      }

      // 允许测试失败但继续记录信息
      expect(hasFileAfterRefresh).toBe(true);

    } catch (error) {
      console.error('[Debug] 测试过程出错:', error);
      throw error;
    } finally {
      await closeElectronApp(app);
    }
  });
});
