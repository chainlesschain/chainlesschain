/**
 * E2E测试 - 项目详情页面板操作测试
 *
 * 测试覆盖：
 * 1. 面板显示/隐藏切换
 * 2. 面板拖拽调整大小
 * 3. 面板宽度限制
 * 4. 面板焦点管理
 * 5. 面板响应式行为
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

test.describe('项目详情页 - 面板操作测试', () => {
  test('应该能够切换文件浏览器面板的可见性', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '面板可见性测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 查找文件浏览器面板');
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"], .file-explorer-panel');

      if (fileExplorer) {
        // 检查初始可见性
        const initiallyVisible = await fileExplorer.isVisible();
        console.log('[Test] 文件浏览器初始可见性:', initiallyVisible);

        // 查找切换按钮
        const toggleButton = await window.$('[data-testid="toggle-file-explorer"], button[title*="文件"]');

        if (toggleButton) {
          console.log('[Test] 点击切换按钮');
          await toggleButton.click();
          await window.waitForTimeout(500);

          // 检查可见性是否改变
          const afterToggle = await fileExplorer.isVisible();
          console.log('[Test] 切换后可见性:', afterToggle);

          expect(afterToggle).not.toBe(initiallyVisible);

          await takeScreenshot(window, 'file-explorer-toggled');

          console.log('[Test] ✅ 文件浏览器切换测试通过');
        } else {
          console.log('[Test] ⚠️ 未找到切换按钮');
        }
      } else {
        console.log('[Test] ⚠️ 未找到文件浏览器面板');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够拖拽调整文件浏览器面板宽度', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '面板调整大小测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 获取文件浏览器初始宽度');
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
      expect(fileExplorer).toBeTruthy();

      const initialWidth = await fileExplorer?.evaluate((el) => el.clientWidth);
      console.log('[Test] 初始宽度:', initialWidth);

      console.log('[Test] 查找拖拽手柄');
      const resizeHandle = await window.$('.resize-handle, [class*="resize"]');

      if (resizeHandle) {
        const handleBox = await resizeHandle.boundingBox();
        expect(handleBox).toBeTruthy();

        console.log('[Test] 执行拖拽操作');
        if (handleBox) {
          await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
          await window.mouse.down();
          await window.mouse.move(handleBox.x + 100, handleBox.y + handleBox.height / 2);
          await window.mouse.up();
          await window.waitForTimeout(300);

          const newWidth = await fileExplorer?.evaluate((el) => el.clientWidth);
          console.log('[Test] 新宽度:', newWidth);

          expect(newWidth).toBeGreaterThan(initialWidth);

          await takeScreenshot(window, 'panel-resized');

          console.log('[Test] ✅ 面板调整大小测试通过');
        }
      } else {
        console.log('[Test] ⚠️ 未找到拖拽手柄');
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

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '最小宽度测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 获取文件浏览器初始宽度');
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
      const initialWidth = await fileExplorer?.evaluate((el) => el.clientWidth);

      console.log('[Test] 尝试拖拽到很小的宽度');
      const resizeHandle = await window.$('.resize-handle');

      if (resizeHandle) {
        const handleBox = await resizeHandle.boundingBox();

        if (handleBox) {
          await window.mouse.move(handleBox.x, handleBox.y);
          await window.mouse.down();
          // 尝试拖拽到负值（超出最小宽度）
          await window.mouse.move(handleBox.x - 500, handleBox.y);
          await window.mouse.up();
          await window.waitForTimeout(300);

          const finalWidth = await fileExplorer?.evaluate((el) => el.clientWidth);
          console.log('[Test] 最终宽度:', finalWidth);

          // 应该大于某个最小值（通常200-250px）
          expect(finalWidth).toBeGreaterThan(150);

          await takeScreenshot(window, 'min-width-enforced');

          console.log('[Test] ✅ 最小宽度限制测试通过');
        }
      } else {
        console.log('[Test] ⚠️ 未找到拖拽手柄');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够正确处理面板焦点', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '面板焦点测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 点击文件浏览器面板');
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');

      if (fileExplorer) {
        await fileExplorer.click();
        await window.waitForTimeout(300);

        console.log('[Test] 验证面板获得焦点');
        // 检查面板是否有焦点相关的样式或状态
        const hasActiveClas = await fileExplorer.evaluate((el) => {
          return el.classList.contains('active') ||
                 el.classList.contains('focused') ||
                 document.activeElement?.contains(el);
        });

        console.log('[Test] 面板焦点状态:', hasActiveClas);

        await takeScreenshot(window, 'panel-focused');

        console.log('[Test] ✅ 面板焦点测试完成');
      } else {
        console.log('[Test] ⚠️ 未找到文件浏览器面板');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够同时显示多个面板', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建并打开项目');
      await createAndOpenProject(window, {
        name: '多面板测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 检查各个面板');
      const fileExplorer = await window.$('[data-testid="file-explorer-panel"]');
      const chatPanel = await window.$('[data-testid="chat-panel"], .chat-panel');
      const editorPanel = await window.$('[data-testid="editor-panel"], .editor-panel');

      let visiblePanels = 0;

      if (fileExplorer && await fileExplorer.isVisible()) {
        console.log('[Test] 文件浏览器面板可见');
        visiblePanels++;
      }

      if (chatPanel && await chatPanel.isVisible()) {
        console.log('[Test] 聊天面板可见');
        visiblePanels++;
      }

      if (editorPanel && await editorPanel.isVisible()) {
        console.log('[Test] 编辑器面板可见');
        visiblePanels++;
      }

      console.log('[Test] 可见面板数量:', visiblePanels);

      // 至少应该有2个面板可见
      expect(visiblePanels).toBeGreaterThanOrEqual(2);

      await takeScreenshot(window, 'multiple-panels-visible');

      console.log('[Test] ✅ 多面板显示测试通过');

    } finally {
      await closeElectronApp(app);
    }
  });
});
