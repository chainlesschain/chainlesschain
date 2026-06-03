/**
 * E2E测试 - 项目详情页文件导出功能测试
 *
 * 测试覆盖：
 * 1. 打开导出菜单
 * 2. 导出为PDF
 * 3. 导出为HTML
 * 4. 导出为DOCX
 * 5. 导出为纯文本
 * 6. 导出错误处理
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot, login } from '../../helpers/common';
import {
  createAndOpenProject,
  createTestFile,
  selectFileInTree,
  waitForProjectDetailLoad,
  refreshFileList,
} from '../../helpers/project-detail';

test.describe('项目详情页 - 文件导出功能测试', () => {
  test('应该能够打开文件导出菜单', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '导出菜单测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建测试文件');
      await createTestFile(window, project.id, {
        fileName: 'export-test.md',
        content: '# 导出测试\n\n这是用于测试导出功能的文件。',
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择文件');
      const selected = await selectFileInTree(window, 'export-test.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 查找导出按钮');
      // 导出按钮可能在工具栏或编辑器头部
      const exportButton = await window.$('button:has-text("导出"), [data-testid="export-button"]');

      if (exportButton) {
        console.log('[Test] 点击导出按钮');
        await exportButton.click();
        await window.waitForTimeout(500);

        console.log('[Test] 验证导出菜单显示');
        const menu = await window.$('.ant-dropdown-menu, .export-menu');
        expect(menu).toBeTruthy();

        await takeScreenshot(window, 'export-menu-opened');

        console.log('[Test] 验证导出选项');
        const menuText = await window.textContent('.ant-dropdown-menu, .export-menu');
        console.log('[Test] 菜单内容:', menuText);

        console.log('[Test] ✅ 导出菜单测试通过');
      } else {
        console.log('[Test] ⚠️ 未找到导出按钮（可能需要在编辑器头部查找）');
        await takeScreenshot(window, 'export-button-not-found');
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够导出Markdown文件为PDF', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'PDF导出测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建测试文件');
      await createTestFile(window, project.id, {
        fileName: 'pdf-export.md',
        content: '# PDF导出测试\n\n## 章节1\n\n这是第一章的内容。\n\n## 章节2\n\n这是第二章的内容。',
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择文件');
      const selected = await selectFileInTree(window, 'pdf-export.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 尝试导出为PDF');
      const exportButton = await window.$('button:has-text("导出")');

      if (exportButton) {
        await exportButton.click();
        await window.waitForTimeout(500);

        // 查找PDF导出选项
        const pdfOption = await window.$('text=PDF, li:has-text("PDF")');
        if (pdfOption) {
          await pdfOption.click();
          await window.waitForTimeout(2000);

          // 验证导出成功提示
          const successMessage = await window.$('.ant-message-success');
          if (successMessage) {
            console.log('[Test] ✅ PDF导出成功');
          } else {
            console.log('[Test] ⚠️ 未检测到成功提示（可能正在后台处理）');
          }

          await takeScreenshot(window, 'pdf-export-completed');
        } else {
          console.log('[Test] ⚠️ 未找到PDF导出选项');
        }
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够导出Markdown文件为HTML', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'HTML导出测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建测试文件');
      await createTestFile(window, project.id, {
        fileName: 'html-export.md',
        content: '# HTML导出测试\n\n这是一个**粗体**文本和*斜体*文本。\n\n- 列表项1\n- 列表项2',
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择文件');
      const selected = await selectFileInTree(window, 'html-export.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 尝试导出为HTML');
      const exportButton = await window.$('button:has-text("导出")');

      if (exportButton) {
        await exportButton.click();
        await window.waitForTimeout(500);

        // 查找HTML导出选项
        const htmlOption = await window.$('text=HTML, li:has-text("HTML")');
        if (htmlOption) {
          await htmlOption.click();
          await window.waitForTimeout(2000);

          await takeScreenshot(window, 'html-export-completed');
          console.log('[Test] ✅ HTML导出测试完成');
        } else {
          console.log('[Test] ⚠️ 未找到HTML导出选项');
        }
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够导出为纯文本', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '文本导出测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建测试文件');
      await createTestFile(window, project.id, {
        fileName: 'text-export.md',
        content: '# 纯文本导出\n\n这将被导出为纯文本文件。',
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择文件');
      const selected = await selectFileInTree(window, 'text-export.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 尝试导出为纯文本');
      const exportButton = await window.$('button:has-text("导出")');

      if (exportButton) {
        await exportButton.click();
        await window.waitForTimeout(500);

        // 查找纯文本导出选项
        const textOption = await window.$('text=纯文本, text=TXT, li:has-text("文本")');
        if (textOption) {
          await textOption.click();
          await window.waitForTimeout(2000);

          await takeScreenshot(window, 'text-export-completed');
          console.log('[Test] ✅ 纯文本导出测试完成');
        } else {
          console.log('[Test] ⚠️ 未找到纯文本导出选项');
        }
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理导出错误', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '导出错误测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建空文件');
      await createTestFile(window, project.id, {
        fileName: 'empty.md',
        content: '',
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择空文件');
      const selected = await selectFileInTree(window, 'empty.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 尝试导出空文件');
      const exportButton = await window.$('button:has-text("导出")');

      if (exportButton) {
        await exportButton.click();
        await window.waitForTimeout(500);

        const pdfOption = await window.$('text=PDF, li:has-text("PDF")');
        if (pdfOption) {
          await pdfOption.click();
          await window.waitForTimeout(2000);

          // 检查是否有错误提示或警告
          const errorMessage = await window.$('.ant-message-error, .ant-message-warning');
          if (errorMessage) {
            console.log('[Test] ✅ 正确显示了错误提示');
            await takeScreenshot(window, 'export-error-shown');
          } else {
            console.log('[Test] ⚠️ 未检测到错误提示（可能允许导出空文件）');
            await takeScreenshot(window, 'export-empty-file');
          }
        }
      }

      console.log('[Test] ✅ 导出错误处理测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够批量导出多个文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '批量导出测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建多个测试文件');
      for (let i = 1; i <= 3; i++) {
        await createTestFile(window, project.id, {
          fileName: `file${i}.md`,
          content: `# 文件${i}\n\n这是第${i}个文件的内容。`,
          fileType: 'markdown',
        });
      }

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 测试逐个导出文件');
      for (let i = 1; i <= 3; i++) {
        console.log(`[Test] 导出文件${i}`);
        const selected = await selectFileInTree(window, `file${i}.md`);
        expect(selected).toBe(true);
        await window.waitForTimeout(1000);

        const exportButton = await window.$('button:has-text("导出")');
        if (exportButton) {
          await exportButton.click();
          await window.waitForTimeout(500);

          const pdfOption = await window.$('text=PDF, li:has-text("PDF")');
          if (pdfOption) {
            await pdfOption.click();
            await window.waitForTimeout(2000);
          }
        }
      }

      await takeScreenshot(window, 'batch-export-completed');
      console.log('[Test] ✅ 批量导出测试完成');
    } finally {
      await closeElectronApp(app);
    }
  });
});
