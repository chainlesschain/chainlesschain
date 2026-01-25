/**
 * Debug测试 - 追踪刷新函数调用
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, login, callIPC } from '../../helpers/common';
import {
  createAndOpenProject,
  waitForProjectDetailLoad,
} from './project-detail-helpers';

test.describe('Debug: 追踪刷新函数', () => {
  test('监控handleRefreshFiles函数调用', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 登录
      await login(window);
      await window.waitForTimeout(1000);

      // 创建项目
      const project = await createAndOpenProject(window, {
        name: '函数追踪测试',
        project_type: 'markdown',
      });

      // 等待页面加载
      await waitForProjectDetailLoad(window);
      await window.waitForTimeout(2000);

      // 注入监听代码
      console.log('[Test] 注入函数监听代码');
      await window.evaluate(() => {
        // 尝试找到Vue实例并hook刷新函数
        (window as any).__refreshCalled = false;
        (window as any).__refreshError = null;

        // 添加全局点击监听
        document.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          console.log('[Click] 点击事件:', target.className, target.tagName);
        });
      });

      // 创建新文件
      console.log('[Test] 创建新文件');
      await callIPC(window, 'file:createFile', {
        projectId: project.id,
        filePath: 'function-test.md',
        content: '# 函数追踪测试',
      });

      await window.waitForTimeout(1000);

      // 使用不同方式点击刷新按钮
      console.log('[Test] 方式1: 查找刷新按钮');
      const refreshButton = await window.$('[data-testid="refresh-files-button"]');
      if (refreshButton) {
        const isVisible = await refreshButton.isVisible();
        const isEnabled = await refreshButton.isEnabled();
        console.log('[Test] 刷新按钮状态 - 可见:', isVisible, '可用:', isEnabled);

        // 获取按钮信息
        const buttonInfo = await refreshButton.evaluate((el) => ({
          tagName: el.tagName,
          className: el.className,
          disabled: (el as HTMLButtonElement).disabled,
          onclick: typeof (el as any).onclick,
        }));
        console.log('[Test] 按钮信息:', buttonInfo);

        // 尝试点击
        console.log('[Test] 点击刷新按钮（force=true）');
        await refreshButton.click({ force: true });
        await window.waitForTimeout(500);
      } else {
        console.log('[Test] ❌ 未找到刷新按钮！');
      }

      // 方式2: 通过evaluate直接调用点击
      console.log('[Test] 方式2: 通过evaluate触发点击');
      await window.evaluate(() => {
        const btn = document.querySelector('[data-testid="refresh-files-button"]') as HTMLElement;
        if (btn) {
          console.log('[Eval] 找到按钮，触发点击');
          btn.click();
        } else {
          console.log('[Eval] 未找到按钮');
        }
      });

      await window.waitForTimeout(2000);

      // 检查是否有日志输出
      console.log('[Test] 等待2秒后检查结果');

      // 获取文件树内容
      const treeContent = await window.textContent('[data-testid="file-tree-container"]');
      const hasFile = treeContent.includes('function-test.md');

      console.log('[Test] 文件是否出现:', hasFile ? '✅ 是' : '❌ 否');
      console.log('[Test] 文件树内容:', treeContent);

      // 检查是否有错误
      const errors = await window.evaluate(() => {
        return (window as any).__refreshError;
      });
      if (errors) {
        console.log('[Test] 捕获到错误:', errors);
      }

    } finally {
      await closeElectronApp(app);
    }
  });
});
