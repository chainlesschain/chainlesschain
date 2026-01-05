/**
 * 项目详情页专用测试辅助函数
 */

import { Page } from '@playwright/test';
import { callIPC } from './helpers';

/**
 * 创建测试项目并导航到详情页
 */
export async function createAndOpenProject(
  window: Page,
  projectData: {
    name: string;
    description?: string;
    project_type?: string;
    enable_git?: boolean;
  }
) {
  // 使用 project:create-quick 避免依赖后端API
  const project = await callIPC(window, 'project:create-quick', projectData);

  // 导航到项目详情页
  await window.evaluate((projectId) => {
    window.location.hash = `#/projects/${projectId}`;
  }, project.id);

  // 等待页面加载
  await window.waitForSelector('[data-testid="project-detail-page"]', { timeout: 10000 });
  await window.waitForTimeout(1000); // 额外等待确保完全加载

  return project;
}

/**
 * 创建测试文件（物理文件 + 数据库记录）
 */
export async function createTestFile(
  window: Page,
  projectId: string,
  fileData: {
    fileName: string;
    content: string;
    fileType: string;
  }
) {
  // Step 1: 创建物理文件
  const result = await callIPC(window, 'file:createFile', {
    projectId,
    filePath: fileData.fileName,
    content: fileData.content,
  });

  // Step 2: 保存文件记录到数据库
  const timestamp = Date.now();
  const fileRecord = {
    project_id: projectId,
    file_name: fileData.fileName,
    file_path: fileData.fileName,
    file_type: fileData.fileType,
    content: fileData.content,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await callIPC(window, 'project:save-files', projectId, [fileRecord]);

  console.log(`[Helper] 文件创建完成: ${fileData.fileName}`);

  // 等待可能的成功提示消失
  await window.waitForTimeout(1000);

  return {
    ...result,
    file_name: fileData.fileName,
    file_type: fileData.fileType,
    content: fileData.content,
  };
}

/**
 * 在文件树中选择文件
 */
export async function selectFileInTree(window: Page, fileName: string): Promise<boolean> {
  try {
    // 等待文件树加载
    await window.waitForSelector('[data-testid="file-tree-container"]', { timeout: 5000 });

    // 多次尝试查找文件（因为文件树可能需要时间刷新）
    let fileNode = null;
    for (let i = 0; i < 5; i++) {
      fileNode = await window.$(`text="${fileName}"`);
      if (fileNode) {
        break;
      }
      console.log(`[Helper] 第${i + 1}次尝试查找文件: ${fileName}`);
      await window.waitForTimeout(1000);
    }

    if (fileNode) {
      // 使用force click绕过modal阻挡
      await fileNode.click({ force: true });
      await window.waitForTimeout(1000);
      console.log(`[Helper] 成功选择文件: ${fileName}`);
      return true;
    }

    console.error(`[Helper] 未找到文件: ${fileName}`);
    // 输出文件树内容以便调试
    const treeContent = await window.textContent('[data-testid="file-tree-container"]');
    console.log('[Helper] 文件树内容:', treeContent);
    return false;
  } catch (error) {
    console.error('Failed to select file in tree:', error);
    return false;
  }
}

/**
 * 发送AI聊天消息
 */
export async function sendChatMessage(window: Page, message: string): Promise<boolean> {
  try {
    // 查找输入框
    const chatInput = await window.$('[data-testid="chat-input"]');
    if (!chatInput) {
      console.error('Chat input not found');
      return false;
    }

    // 输入消息
    await chatInput.fill(message);
    await window.waitForTimeout(300);

    // 查找并点击发送按钮
    const sendButton = await window.$('[data-testid="chat-send-button"]');
    if (!sendButton) {
      console.error('Send button not found');
      return false;
    }

    await sendButton.click();
    await window.waitForTimeout(1000);

    return true;
  } catch (error) {
    console.error('Failed to send chat message:', error);
    return false;
  }
}

/**
 * 等待AI响应完成
 */
export async function waitForAIResponse(window: Page, timeout: number = 30000): Promise<boolean> {
  try {
    // 等待加载指示器出现
    await window.waitForSelector('[data-testid="message-loading"]', { timeout: 5000 });

    // 等待加载指示器消失
    await window.waitForSelector('[data-testid="message-loading"]', {
      state: 'hidden',
      timeout,
    });

    return true;
  } catch (error) {
    console.error('Failed to wait for AI response:', error);
    return false;
  }
}

/**
 * 获取所有聊天消息
 */
export async function getChatMessages(window: Page): Promise<string[]> {
  try {
    const messagesList = await window.$('[data-testid="messages-list"]');
    if (!messagesList) {
      return [];
    }

    const messages = await window.$$('.message-item');
    const messageTexts: string[] = [];

    for (const msg of messages) {
      const text = await msg.textContent();
      if (text) {
        messageTexts.push(text.trim());
      }
    }

    return messageTexts;
  } catch (error) {
    console.error('Failed to get chat messages:', error);
    return [];
  }
}

/**
 * 切换上下文模式
 */
export async function switchContextMode(
  window: Page,
  mode: 'project' | 'file' | 'global'
): Promise<boolean> {
  try {
    const button = await window.$(`[data-testid="context-mode-${mode}"]`);
    if (!button) {
      console.error(`Context mode button not found: ${mode}`);
      return false;
    }

    await button.click();
    await window.waitForTimeout(300);
    return true;
  } catch (error) {
    console.error('Failed to switch context mode:', error);
    return false;
  }
}

/**
 * 保存当前文件
 */
export async function saveCurrentFile(window: Page): Promise<boolean> {
  try {
    const saveButton = await window.$('[data-testid="save-button"]');
    if (!saveButton) {
      console.error('Save button not found');
      return false;
    }

    // 检查按钮是否可用
    const isDisabled = await saveButton.evaluate((el) => (el as HTMLButtonElement).disabled);
    if (isDisabled) {
      console.warn('Save button is disabled');
      return false;
    }

    await saveButton.click();

    // 等待保存成功提示
    await window.waitForSelector('.ant-message-success', { timeout: 5000 });

    return true;
  } catch (error) {
    console.error('Failed to save file:', error);
    return false;
  }
}

/**
 * 刷新文件列表
 */
export async function refreshFileList(window: Page): Promise<boolean> {
  try {
    // 先尝试关闭可能存在的modal
    try {
      const closeButtons = await window.$$('.ant-modal-close, .ant-message-notice-close');
      for (const closeBtn of closeButtons) {
        if (await closeBtn.isVisible()) {
          await closeBtn.click({ force: true });
          await window.waitForTimeout(300);
        }
      }
    } catch (e) {
      // 忽略关闭modal的错误
    }

    // 使用evaluate直接触发DOM点击，这样更可靠
    const clicked = await window.evaluate(() => {
      const btn = document.querySelector('[data-testid="refresh-files-button"]') as HTMLElement;
      if (btn) {
        console.log('[Helper] 找到刷新按钮，触发点击');
        btn.click();
        return true;
      }
      console.log('[Helper] 未找到刷新按钮');
      return false;
    });

    if (!clicked) {
      console.error('[Helper] Refresh button not found');
      return false;
    }

    // 等待刷新完成
    await window.waitForTimeout(2000);

    return true;
  } catch (error) {
    console.error('[Helper] Failed to refresh file list:', error);
    return false;
  }
}

/**
 * 打开Git菜单并选择操作
 */
export async function performGitAction(
  window: Page,
  action: 'status' | 'history' | 'commit' | 'push' | 'pull'
): Promise<boolean> {
  try {
    // 点击Git按钮
    const gitButton = await window.$('[data-testid="git-actions-button"]');
    if (!gitButton) {
      console.error('Git actions button not found');
      return false;
    }

    await gitButton.click();
    await window.waitForTimeout(300);

    // 等待菜单显示
    await window.waitForSelector('[data-testid="git-actions-menu"]', { timeout: 2000 });

    // 点击对应的菜单项
    const menuItem = await window.$(`[data-testid="git-${action}-item"]`);
    if (!menuItem) {
      console.error(`Git menu item not found: ${action}`);
      return false;
    }

    await menuItem.click();
    await window.waitForTimeout(1000);

    return true;
  } catch (error) {
    console.error('Failed to perform git action:', error);
    return false;
  }
}

/**
 * 切换编辑器面板显示/隐藏
 */
export async function toggleEditorPanel(window: Page): Promise<boolean> {
  try {
    const toggleButton = await window.$('[data-testid="toggle-editor-button"]');
    if (!toggleButton) {
      console.error('Toggle editor button not found');
      return false;
    }

    await toggleButton.click();
    await window.waitForTimeout(500);

    return true;
  } catch (error) {
    console.error('Failed to toggle editor panel:', error);
    return false;
  }
}

/**
 * 打开文件管理对话框
 */
export async function openFileManageModal(window: Page): Promise<boolean> {
  try {
    const button = await window.$('[data-testid="file-manage-button"]');
    if (!button) {
      console.error('File manage button not found');
      return false;
    }

    await button.click();
    await window.waitForTimeout(500);

    // 验证对话框打开
    const modal = await window.$('.ant-modal');
    return modal !== null;
  } catch (error) {
    console.error('Failed to open file manage modal:', error);
    return false;
  }
}

/**
 * 打开分享对话框
 */
export async function openShareModal(window: Page): Promise<boolean> {
  try {
    const button = await window.$('[data-testid="share-button"]');
    if (!button) {
      console.error('Share button not found');
      return false;
    }

    await button.click();
    await window.waitForTimeout(500);

    // 验证对话框打开
    const modal = await window.$('.ant-modal');
    return modal !== null;
  } catch (error) {
    console.error('Failed to open share modal:', error);
    return false;
  }
}

/**
 * 等待项目详情页加载完成
 */
export async function waitForProjectDetailLoad(window: Page, timeout: number = 10000): Promise<boolean> {
  try {
    // 等待主容器
    await window.waitForSelector('[data-testid="project-detail-page"]', { timeout });

    // 等待文件树
    await window.waitForSelector('[data-testid="file-explorer-panel"]', { timeout });

    // 等待聊天面板
    await window.waitForSelector('[data-testid="chat-panel"]', { timeout });

    await window.waitForTimeout(1000);

    // 关闭可能出现的首次使用向导modal
    try {
      const modal = await window.$('.ant-modal-wrap:visible');
      if (modal) {
        console.log('[Helper] 检测到首次使用向导modal，尝试关闭...');

        // 尝试点击关闭按钮或ESC键
        const closeButton = await window.$('.ant-modal-close');
        if (closeButton && await closeButton.isVisible()) {
          await closeButton.click({ force: true });
          await window.waitForTimeout(500);
          console.log('[Helper] 已关闭首次使用向导modal');
        } else {
          // 如果没有关闭按钮，按ESC键
          await window.keyboard.press('Escape');
          await window.waitForTimeout(500);
          console.log('[Helper] 使用ESC键关闭modal');
        }
      }
    } catch (e) {
      // 忽略关闭modal的错误
      console.log('[Helper] 未发现modal或关闭失败（这是正常的）');
    }

    return true;
  } catch (error) {
    console.error('Failed to wait for project detail load:', error);
    return false;
  }
}

/**
 * 检查是否有未保存的更改
 */
export async function hasUnsavedChanges(window: Page): Promise<boolean> {
  try {
    const saveButton = await window.$('[data-testid="save-button"]');
    if (!saveButton) {
      return false;
    }

    const isDisabled = await saveButton.evaluate((el) => (el as HTMLButtonElement).disabled);
    return !isDisabled; // 如果按钮可用，说明有未保存的更改
  } catch (error) {
    console.error('Failed to check unsaved changes:', error);
    return false;
  }
}

/**
 * 返回项目列表
 */
export async function backToProjectList(window: Page): Promise<boolean> {
  try {
    const backLink = await window.$('[data-testid="back-to-projects-link"]');
    if (!backLink) {
      console.error('Back to projects link not found');
      return false;
    }

    await backLink.click();
    await window.waitForTimeout(1000);

    // 验证是否返回到项目列表
    const hash = await window.evaluate(() => window.location.hash);
    return hash.includes('projects') && !hash.includes('/projects/');
  } catch (error) {
    console.error('Failed to go back to project list:', error);
    return false;
  }
}

/**
 * 切换文件树模式（虚拟/标准）
 */
export async function toggleFileTreeMode(window: Page): Promise<boolean> {
  try {
    const switchButton = await window.$('[data-testid="file-tree-mode-switch"]');
    if (!switchButton) {
      console.error('File tree mode switch not found');
      return false;
    }

    await switchButton.click();
    await window.waitForTimeout(500);

    return true;
  } catch (error) {
    console.error('Failed to toggle file tree mode:', error);
    return false;
  }
}

/**
 * 清空对话历史
 */
export async function clearConversation(window: Page): Promise<boolean> {
  try {
    const clearButton = await window.$('[data-testid="clear-conversation-button"]');
    if (!clearButton) {
      console.error('Clear conversation button not found');
      return false;
    }

    // 检查按钮是否可用
    const isDisabled = await clearButton.evaluate((el) => (el as HTMLButtonElement).disabled);
    if (isDisabled) {
      console.warn('Clear conversation button is disabled');
      return false;
    }

    await clearButton.click();
    await window.waitForTimeout(500);

    return true;
  } catch (error) {
    console.error('Failed to clear conversation:', error);
    return false;
  }
}
