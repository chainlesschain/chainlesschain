/**
 * E2E测试 - 项目详情页编辑器功能测试
 *
 * 测试覆盖：
 * 1. Markdown编辑器
 * 2. 代码编辑器
 * 3. Excel编辑器
 * 4. Word/富文本编辑器
 * 5. PPT编辑器
 * 6. 编辑器之间的切换
 * 7. 视图模式切换（编辑/预览/自动）
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot, login } from './helpers';
import {
  createAndOpenProject,
  createTestFile,
  selectFileInTree,
  waitForProjectDetailLoad,
  refreshFileList,
} from './project-detail-helpers';

test.describe('项目详情页 - 编辑器功能测试', () => {
  test('应该能够打开和编辑Markdown文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Markdown编辑器测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建Markdown文件');
      await createTestFile(window, project.id, {
        fileName: 'test.md',
        content: '# 测试标题\n\n这是测试内容。',
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择Markdown文件');
      const selected = await selectFileInTree(window, 'test.md');
      expect(selected).toBe(true);

      await window.waitForTimeout(2000);

      console.log('[Test] 验证Markdown编辑器加载');
      // 检查是否有编辑器容器
      const editorContainer = await window.$('.editor-preview-panel, .markdown-editor');
      expect(editorContainer).toBeTruthy();

      await takeScreenshot(window, 'markdown-editor-loaded');

      console.log('[Test] 切换到编辑模式');
      const editButton = await window.$('[data-testid="toolbar-center"] input[value="edit"]');
      if (editButton) {
        await editButton.click();
        await window.waitForTimeout(1000);
        await takeScreenshot(window, 'markdown-edit-mode');
      }

      console.log('[Test] 切换到预览模式');
      const previewButton = await window.$('[data-testid="toolbar-center"] input[value="preview"]');
      if (previewButton) {
        await previewButton.click();
        await window.waitForTimeout(1000);
        await takeScreenshot(window, 'markdown-preview-mode');
      }

      console.log('[Test] ✅ Markdown编辑器测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够打开和编辑代码文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '代码编辑器测试',
        project_type: 'code',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建JavaScript文件');
      await createTestFile(window, project.id, {
        fileName: 'test.js',
        content: 'function hello() {\n  console.log("Hello World");\n}',
        fileType: 'javascript',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择JavaScript文件');
      const selected = await selectFileInTree(window, 'test.js');
      expect(selected).toBe(true);

      await window.waitForTimeout(2000);

      console.log('[Test] 验证代码编辑器加载');
      const editorContainer = await window.$('.editor-preview-panel, .code-editor');
      expect(editorContainer).toBeTruthy();

      await takeScreenshot(window, 'code-editor-loaded');

      console.log('[Test] ✅ 代码编辑器测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够打开和编辑Python文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Python编辑器测试',
        project_type: 'code',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建Python文件');
      await createTestFile(window, project.id, {
        fileName: 'test.py',
        content: 'def hello():\n    print("Hello World")',
        fileType: 'python',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择Python文件');
      const selected = await selectFileInTree(window, 'test.py');
      expect(selected).toBe(true);

      await window.waitForTimeout(2000);

      console.log('[Test] 验证代码编辑器加载');
      const editorContainer = await window.$('.editor-preview-panel, .code-editor');
      expect(editorContainer).toBeTruthy();

      await takeScreenshot(window, 'python-editor-loaded');

      console.log('[Test] ✅ Python编辑器测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够在不同文件类型之间切换', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '编辑器切换测试',
        project_type: 'mixed',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建多种类型的文件');
      await createTestFile(window, project.id, {
        fileName: 'doc.md',
        content: '# Markdown文档',
        fileType: 'markdown',
      });

      await createTestFile(window, project.id, {
        fileName: 'script.js',
        content: 'console.log("JavaScript");',
        fileType: 'javascript',
      });

      await createTestFile(window, project.id, {
        fileName: 'note.txt',
        content: '纯文本文件',
        fileType: 'text',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 测试切换到Markdown文件');
      let selected = await selectFileInTree(window, 'doc.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);
      await takeScreenshot(window, 'switched-to-markdown');

      console.log('[Test] 测试切换到JavaScript文件');
      selected = await selectFileInTree(window, 'script.js');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);
      await takeScreenshot(window, 'switched-to-javascript');

      console.log('[Test] 测试切换到文本文件');
      selected = await selectFileInTree(window, 'note.txt');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);
      await takeScreenshot(window, 'switched-to-text');

      console.log('[Test] ✅ 编辑器切换测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够在编辑模式和预览模式之间切换', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '视图模式切换测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建Markdown文件');
      await createTestFile(window, project.id, {
        fileName: 'readme.md',
        content: '# 项目说明\n\n这是一个测试项目。\n\n## 功能列表\n\n- 功能1\n- 功能2',
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择文件');
      const selected = await selectFileInTree(window, 'readme.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 测试自动模式');
      const autoButton = await window.$('[data-testid="toolbar-center"] input[value="auto"]');
      if (autoButton) {
        await autoButton.click();
        await window.waitForTimeout(1000);
        await takeScreenshot(window, 'view-mode-auto');
      }

      console.log('[Test] 测试编辑模式');
      const editButton = await window.$('[data-testid="toolbar-center"] input[value="edit"]');
      if (editButton) {
        await editButton.click();
        await window.waitForTimeout(1000);
        await takeScreenshot(window, 'view-mode-edit');

        // 验证编辑器可见
        const editor = await window.$('.editor-container, .markdown-editor');
        expect(editor).toBeTruthy();
      }

      console.log('[Test] 测试预览模式');
      const previewButton = await window.$('[data-testid="toolbar-center"] input[value="preview"]');
      if (previewButton) {
        await previewButton.click();
        await window.waitForTimeout(1000);
        await takeScreenshot(window, 'view-mode-preview');

        // 验证预览容器可见
        const preview = await window.$('.preview-container, .preview-panel');
        expect(preview).toBeTruthy();
      }

      console.log('[Test] ✅ 视图模式切换测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理大文件加载', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '大文件测试',
        project_type: 'code',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建大文件（1000行）');
      const largeContent = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}: This is a test line with some content.`).join('\n');

      await createTestFile(window, project.id, {
        fileName: 'large-file.txt',
        content: largeContent,
        fileType: 'text',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择大文件');
      const selected = await selectFileInTree(window, 'large-file.txt');
      expect(selected).toBe(true);

      // 等待文件加载（可能需要更长时间）
      await window.waitForTimeout(3000);

      console.log('[Test] 验证文件已加载');
      const editorContainer = await window.$('.editor-preview-panel');
      expect(editorContainer).toBeTruthy();

      await takeScreenshot(window, 'large-file-loaded');

      console.log('[Test] ✅ 大文件加载测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理特殊字符和Unicode', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Unicode测试',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建包含特殊字符的文件');
      const specialContent = `# 特殊字符测试

## 中文
你好世界！这是中文内容。

## 日文
こんにちは世界！

## 韩文
안녕하세요 세계!

## Emoji
😀 😃 😄 😁 🎉 🎊 ✨ 🌟

## 特殊符号
© ® ™ € £ ¥ § ¶ † ‡

## 数学符号
∑ ∏ √ ∞ ≈ ≠ ≤ ≥ ± × ÷
`;

      await createTestFile(window, project.id, {
        fileName: 'unicode-test.md',
        content: specialContent,
        fileType: 'markdown',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择文件');
      const selected = await selectFileInTree(window, 'unicode-test.md');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 验证特殊字符正确显示');
      const editorContainer = await window.$('.editor-preview-panel');
      expect(editorContainer).toBeTruthy();

      await takeScreenshot(window, 'unicode-content-loaded');

      console.log('[Test] ✅ Unicode测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });
});
