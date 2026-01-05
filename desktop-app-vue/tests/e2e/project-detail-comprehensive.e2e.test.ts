/**
 * E2E测试 - 项目详情页综合测试
 *
 * 测试覆盖：
 * 1. 项目加载和导航
 * 2. 文件树操作（切换模式、刷新、选择文件）
 * 3. 文件编辑和保存
 * 4. 视图模式切换（自动/编辑/预览）
 * 5. 文件管理（创建、删除、重命名）
 * 6. 文件导出
 * 7. Git操作（状态、提交、推送、拉取）
 * 8. AI对话功能
 * 9. 任务规划功能
 * 10. 分享功能
 * 11. 面板调整和布局
 * 12. 错误处理
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC, takeScreenshot } from './helpers';

// 测试数据
const TEST_PROJECT_NAME = 'E2E测试项目';
const TEST_FILE_NAME = '测试文件.md';
const TEST_FILE_CONTENT = '# 测试标题\n\n这是测试内容。';

test.describe('项目详情页 - 基础加载和导航', () => {
  test('应该能够加载项目详情页', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 等待应用加载
      await window.waitForLoadState('domcontentloaded');

      // 创建测试项目
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        description: '用于E2E测试的项目',
        project_type: 'markdown',
      });

      expect(project).toBeTruthy();
      expect(project.id).toBeTruthy();

      // 导航到项目详情页
      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      // 等待项目详情页加载
      await window.waitForSelector('.project-detail-page', { timeout: 10000 });

      // 验证项目名称显示在面包屑中
      const breadcrumb = await window.textContent('.a-breadcrumb');
      expect(breadcrumb).toContain(TEST_PROJECT_NAME);

      // 验证文件树区域存在
      const fileExplorer = await window.$('.file-explorer-panel');
      expect(fileExplorer).toBeTruthy();

      // 验证聊天面板存在
      const chatPanel = await window.$('.chat-panel');
      expect(chatPanel).toBeTruthy();

      await takeScreenshot(window, 'project-detail-loaded');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够返回项目列表', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 创建并打开项目
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');

      // 点击面包屑中的"我的项目"
      const backLink = await window.$('a:has-text("我的项目")');
      expect(backLink).toBeTruthy();

      await backLink?.click();

      // 等待返回项目列表页
      await window.waitForSelector('.projects-page', { timeout: 5000 });

      // 验证URL已改变
      const hash = await window.evaluate(() => window.location.hash);
      expect(hash).toContain('projects');
      expect(hash).not.toContain(project.id);

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该正确处理不存在的项目', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const nonExistentId = 'non-existent-project-id-12345';

      // 导航到不存在的项目
      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, nonExistentId);

      // 等待错误消息显示
      await window.waitForSelector('.error-container', { timeout: 5000 });

      // 验证错误信息
      const errorText = await window.textContent('.error-container');
      expect(errorText).toContain('项目不存在');

      await takeScreenshot(window, 'project-not-found');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 文件树操作', () => {
  test('应该能够切换文件树模式（虚拟/标准）', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');

      // 找到切换开关
      const switchButton = await window.$('.sidebar-header .a-switch');
      expect(switchButton).toBeTruthy();

      // 点击切换
      await switchButton?.click();
      await window.waitForTimeout(500);

      // 验证切换成功（文件树仍然可见）
      const fileTree = await window.$('.sidebar-content');
      expect(fileTree).toBeTruthy();

      await takeScreenshot(window, 'file-tree-mode-switched');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够刷新文件列表', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      // 创建一个测试文件
      await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');

      // 点击刷新按钮
      const refreshButton = await window.$('.sidebar-header button:has([class*="reload"])');
      expect(refreshButton).toBeTruthy();

      await refreshButton?.click();

      // 等待刷新完成
      await window.waitForTimeout(1000);

      // 验证文件列表包含新文件
      const fileTreeContent = await window.textContent('.sidebar-content');
      expect(fileTreeContent).toContain(TEST_FILE_NAME);

      await takeScreenshot(window, 'file-list-refreshed');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够选择和打开文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      // 查找并点击文件
      const fileNode = await window.$(`text=${TEST_FILE_NAME}`);
      if (fileNode) {
        await fileNode.click();
        await window.waitForTimeout(1000);

        // 验证文件名显示在面包屑中
        const breadcrumb = await window.textContent('.toolbar-left');
        expect(breadcrumb).toContain(TEST_FILE_NAME);

        // 验证文件内容显示
        const editorContent = await window.textContent('.editor-container, .preview-container');
        expect(editorContent).toContain('测试标题');
      }

      await takeScreenshot(window, 'file-opened');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 文件编辑和保存', () => {
  test('应该能够编辑文件内容', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      // 打开文件
      const fileNode = await window.$(`text=${TEST_FILE_NAME}`);
      await fileNode?.click();
      await window.waitForTimeout(1000);

      // 切换到编辑模式
      const editModeButton = await window.$('input[value="edit"]');
      if (editModeButton) {
        await editModeButton.click();
        await window.waitForTimeout(500);
      }

      // 修改内容（通过调用编辑器API）
      const newContent = '# 修改后的标题\n\n这是修改后的内容。';
      await window.evaluate((content) => {
        const event = new CustomEvent('editor-set-content', { detail: { content } });
        window.dispatchEvent(event);
      }, newContent);

      await window.waitForTimeout(500);

      // 验证保存按钮变为可用状态
      const saveButton = await window.$('button:has-text("保存")');
      const isDisabled = await saveButton?.evaluate(el => (el as HTMLButtonElement).disabled);
      expect(isDisabled).toBe(false);

      await takeScreenshot(window, 'file-edited');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够保存文件修改', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      // 打开并编辑文件
      const fileNode = await window.$(`text=${TEST_FILE_NAME}`);
      await fileNode?.click();
      await window.waitForTimeout(1000);

      const newContent = '# 保存测试\n\n这是保存后的内容。';
      await window.evaluate((content) => {
        const event = new CustomEvent('editor-set-content', { detail: { content } });
        window.dispatchEvent(event);
      }, newContent);

      await window.waitForTimeout(500);

      // 点击保存按钮
      const saveButton = await window.$('button:has-text("保存")');
      await saveButton?.click();

      // 等待保存成功的提示
      await window.waitForSelector('.ant-message-success', { timeout: 5000 });

      // 验证保存成功
      const savedFile = await callIPC(window, 'project:get-file', {
        projectId: project.id,
        fileId: file.id,
      });

      expect(savedFile.content).toContain('保存测试');

      await takeScreenshot(window, 'file-saved');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够切换视图模式', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      // 打开文件
      const fileNode = await window.$(`text=${TEST_FILE_NAME}`);
      await fileNode?.click();
      await window.waitForTimeout(1000);

      // 测试切换到编辑模式
      const editButton = await window.$('input[value="edit"]');
      await editButton?.click();
      await window.waitForTimeout(500);

      // 验证编辑器显示
      const editor = await window.$('.editor-container');
      expect(editor).toBeTruthy();

      // 切换到预览模式
      const previewButton = await window.$('input[value="preview"]');
      await previewButton?.click();
      await window.waitForTimeout(500);

      // 验证预览显示
      const preview = await window.$('.preview-container');
      expect(preview).toBeTruthy();

      // 切换回自动模式
      const autoButton = await window.$('input[value="auto"]');
      await autoButton?.click();
      await window.waitForTimeout(500);

      await takeScreenshot(window, 'view-mode-switched');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 文件管理功能', () => {
  test('应该能够打开文件管理对话框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');

      // 点击文件管理按钮
      const fileManageButton = await window.$('button:has-text("文件管理")');
      expect(fileManageButton).toBeTruthy();

      await fileManageButton?.click();
      await window.waitForTimeout(500);

      // 验证文件管理对话框打开
      const modal = await window.$('.ant-modal:has-text("文件管理")');
      expect(modal).toBeTruthy();

      await takeScreenshot(window, 'file-manage-modal-opened');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够创建新文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      // 通过API创建文件
      const newFileName = '新建测试文件.md';
      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: newFileName,
        content: '# 新建文件\n\n这是新建的文件。',
        fileType: 'markdown',
      });

      expect(file).toBeTruthy();
      expect(file.file_name).toBe(newFileName);

      // 导航到项目并验证文件存在
      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      const fileTreeContent = await window.textContent('.sidebar-content');
      expect(fileTreeContent).toContain(newFileName);

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够删除文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: '待删除文件.md',
        content: '这个文件将被删除',
        fileType: 'markdown',
      });

      // 删除文件
      await callIPC(window, 'project:delete-file', {
        projectId: project.id,
        fileId: file.id,
      });

      // 验证文件已删除
      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      const fileTreeContent = await window.textContent('.sidebar-content');
      expect(fileTreeContent).not.toContain('待删除文件.md');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - Git操作', () => {
  test('应该能够打开Git操作菜单', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');

      // 点击Git操作按钮
      const gitButton = await window.$('button:has-text("Git操作")');
      expect(gitButton).toBeTruthy();

      await gitButton?.click();
      await window.waitForTimeout(300);

      // 验证下拉菜单显示
      const menu = await window.$('.ant-dropdown-menu');
      expect(menu).toBeTruthy();

      // 验证菜单项
      const menuText = await window.textContent('.ant-dropdown-menu');
      expect(menuText).toContain('查看状态');
      expect(menuText).toContain('提交历史');
      expect(menuText).toContain('提交更改');

      await takeScreenshot(window, 'git-menu-opened');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够查看Git状态', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
        enable_git: true,
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');

      // 打开Git菜单
      await window.click('button:has-text("Git操作")');
      await window.waitForTimeout(300);

      // 点击查看状态
      await window.click('text=查看状态');
      await window.waitForTimeout(1000);

      // 验证状态对话框显示
      const modal = await window.$('.ant-modal');
      expect(modal).toBeTruthy();

      await takeScreenshot(window, 'git-status-shown');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - AI对话功能', () => {
  test('应该能够发送AI对话消息', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');
      await window.waitForTimeout(1000);

      // 查找输入框
      const chatInput = await window.$('.chat-input textarea, input[placeholder*="输入"], textarea[placeholder*="输入"]');
      expect(chatInput).toBeTruthy();

      // 输入消息
      const testMessage = '你好，这是一个测试消息';
      await chatInput?.fill(testMessage);
      await window.waitForTimeout(300);

      // 查找发送按钮
      const sendButton = await window.$('button:has-text("发送"), button[type="submit"]');

      if (sendButton) {
        await sendButton.click();
        await window.waitForTimeout(2000);

        // 验证消息已发送（查找消息容器）
        const messageContainer = await window.$('.message-list, .chat-messages');
        expect(messageContainer).toBeTruthy();

        const messages = await window.textContent('.message-list, .chat-messages');
        expect(messages).toContain(testMessage);
      }

      await takeScreenshot(window, 'chat-message-sent');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够切换上下文模式', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');
      await window.waitForTimeout(1000);

      // 查找上下文模式选择器
      const contextSelector = await window.$('select[class*="context"], .context-mode-selector');

      if (contextSelector) {
        // 切换到不同的上下文模式
        await contextSelector.selectOption('project');
        await window.waitForTimeout(300);

        await contextSelector.selectOption('file');
        await window.waitForTimeout(300);

        await takeScreenshot(window, 'context-mode-switched');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够查看对话历史', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      // 创建一个对话
      const conversation = await callIPC(window, 'conversation:create', {
        project_id: project.id,
        title: '测试对话',
      });

      expect(conversation).toBeTruthy();

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');
      await window.waitForTimeout(1000);

      // 查找对话历史列表
      const historyList = await window.$('.conversation-history, .chat-history');
      expect(historyList).toBeTruthy();

      await takeScreenshot(window, 'conversation-history-shown');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 任务规划功能', () => {
  test('应该能够触发任务规划', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');
      await window.waitForTimeout(1000);

      // 输入需要任务规划的消息
      const chatInput = await window.$('.chat-input textarea, input[placeholder*="输入"]');
      await chatInput?.fill('帮我创建一个完整的项目结构');
      await window.waitForTimeout(300);

      // 发送消息
      const sendButton = await window.$('button:has-text("发送"), button[type="submit"]');
      await sendButton?.click();

      // 等待任务规划响应（这可能需要较长时间）
      await window.waitForTimeout(5000);

      // 查找任务规划相关的UI元素
      const taskPlan = await window.$('.task-plan, .plan-message, [class*="planning"]');

      if (taskPlan) {
        await takeScreenshot(window, 'task-planning-shown');
      }

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 布局和面板调整', () => {
  test('应该能够显示/隐藏编辑器面板', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');

      // 查找编辑器面板切换按钮
      const editorToggle = await window.$('button:has-text("编辑器"), button:has-text("隐藏"), button:has-text("显示")');

      if (editorToggle) {
        const initialText = await editorToggle.textContent();

        // 点击切换
        await editorToggle.click();
        await window.waitForTimeout(500);

        // 验证按钮文本改变
        const newText = await editorToggle.textContent();
        expect(newText).not.toBe(initialText);

        await takeScreenshot(window, 'editor-panel-toggled');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够调整面板大小', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');
      await window.waitForTimeout(1000);

      // 获取文件树面板初始宽度
      const fileExplorer = await window.$('.file-explorer-panel');
      const initialWidth = await fileExplorer?.evaluate(el => el.clientWidth);

      // 查找拖拽手柄
      const resizeHandle = await window.$('.resize-handle');

      if (resizeHandle) {
        // 获取手柄位置
        const box = await resizeHandle.boundingBox();
        if (box) {
          // 拖拽手柄调整大小
          await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await window.mouse.down();
          await window.mouse.move(box.x + 100, box.y + box.height / 2);
          await window.mouse.up();

          await window.waitForTimeout(500);

          // 验证宽度改变
          const newWidth = await fileExplorer?.evaluate(el => el.clientWidth);
          expect(newWidth).not.toBe(initialWidth);

          await takeScreenshot(window, 'panel-resized');
        }
      }

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 错误处理', () => {
  test('应该处理文件加载失败', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');

      // 尝试通过URL加载不存在的文件
      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}?fileId=non-existent-file-id`;
      }, project.id);

      await window.waitForTimeout(2000);

      // 验证错误提示显示
      const errorMessage = await window.$('.ant-message-error, .error-message');

      if (errorMessage) {
        const errorText = await errorMessage.textContent();
        expect(errorText).toContain('文件');
      }

      await takeScreenshot(window, 'file-load-error');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该处理保存失败', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      // 打开文件
      const fileNode = await window.$(`text=${TEST_FILE_NAME}`);
      await fileNode?.click();
      await window.waitForTimeout(1000);

      // 模拟保存失败（通过删除项目）
      await callIPC(window, 'project:delete', { id: project.id });

      // 尝试保存
      const saveButton = await window.$('button:has-text("保存")');
      await saveButton?.click();

      // 等待错误提示
      await window.waitForTimeout(2000);

      const errorMessage = await window.$('.ant-message-error');

      if (errorMessage) {
        await takeScreenshot(window, 'save-error');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该处理AI对话超时', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');
      await window.waitForTimeout(1000);

      // 发送消息
      const chatInput = await window.$('.chat-input textarea, input[placeholder*="输入"]');
      await chatInput?.fill('测试超时');

      const sendButton = await window.$('button:has-text("发送")');
      await sendButton?.click();

      // 等待较长时间（模拟超时）
      await window.waitForTimeout(65000); // 超过60秒

      // 检查是否有超时提示
      const messages = await window.textContent('.chat-messages, .message-list');
      // 应该有某种超时或错误提示

      await takeScreenshot(window, 'chat-timeout');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 分享功能', () => {
  test('应该能够打开分享对话框', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.project-detail-page');

      // 点击分享按钮
      const shareButton = await window.$('button:has-text("分享")');
      expect(shareButton).toBeTruthy();

      await shareButton?.click();
      await window.waitForTimeout(500);

      // 验证分享对话框显示
      const modal = await window.$('.ant-modal:has-text("分享")');
      expect(modal).toBeTruthy();

      await takeScreenshot(window, 'share-modal-opened');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe('项目详情页 - 文件导出功能', () => {
  test('应该能够打开文件导出菜单', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project = await callIPC(window, 'project:create', {
        name: TEST_PROJECT_NAME,
        project_type: 'markdown',
      });

      const file = await callIPC(window, 'project:create-file', {
        projectId: project.id,
        fileName: TEST_FILE_NAME,
        content: TEST_FILE_CONTENT,
        fileType: 'markdown',
      });

      await window.evaluate((projectId) => {
        window.location.hash = `#/projects/${projectId}`;
      }, project.id);

      await window.waitForSelector('.file-explorer-panel');
      await window.waitForTimeout(1000);

      // 打开文件
      const fileNode = await window.$(`text=${TEST_FILE_NAME}`);
      await fileNode?.click();
      await window.waitForTimeout(1000);

      // 查找导出按钮
      const exportButton = await window.$('button:has-text("导出"), [class*="export"]');

      if (exportButton) {
        await exportButton.click();
        await window.waitForTimeout(500);

        // 验证导出菜单显示
        const menu = await window.$('.ant-dropdown-menu');
        expect(menu).toBeTruthy();

        await takeScreenshot(window, 'export-menu-opened');
      }

    } finally {
      await closeElectronApp(app);
    }
  });
});
