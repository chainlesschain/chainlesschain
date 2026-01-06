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
    // 输入消息并点击发送
    const success = await window.evaluate((msg) => {
      const input = document.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement;
      if (!input) {
        console.error('[Helper] Chat input not found');
        return false;
      }

      // 设置输入值
      input.value = msg;
      // 触发input事件让Vue响应
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // 等待一小会儿让Vue更新
      setTimeout(() => {
        const btn = document.querySelector('[data-testid="chat-send-button"]') as HTMLElement;
        if (btn) {
          btn.click();
        }
      }, 100);

      return true;
    }, message);

    if (!success) {
      console.error('[Helper] Failed to send chat message');
      return false;
    }

    await window.waitForTimeout(1000);

    return true;
  } catch (error) {
    console.error('[Helper] Failed to send chat message:', error);
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
    const clicked = await window.evaluate((modeValue) => {
      const btn = document.querySelector(`[data-testid="context-mode-${modeValue}"]`) as HTMLElement;
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, mode);

    if (!clicked) {
      console.error(`Context mode button not found: ${mode}`);
      return false;
    }

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
    const clicked = await window.evaluate(() => {
      const btn = document.querySelector('[data-testid="toggle-editor-button"]') as HTMLElement;
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      console.error('Toggle editor button not found');
      return false;
    }

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
    // 使用evaluate直接触发DOM点击，绕过遮罩层
    const clicked = await window.evaluate(() => {
      const btn = document.querySelector('[data-testid="file-manage-button"]') as HTMLElement;
      if (btn) {
        console.log('[Helper] 找到文件管理按钮，触发点击');
        btn.click();
        return true;
      }
      console.log('[Helper] 未找到文件管理按钮');
      return false;
    });

    if (!clicked) {
      console.error('[Helper] File manage button not found');
      return false;
    }

    await window.waitForTimeout(500);

    // 验证对话框打开
    const modal = await window.$('.ant-modal');
    return modal !== null;
  } catch (error) {
    console.error('[Helper] Failed to open file manage modal:', error);
    return false;
  }
}

/**
 * 打开分享对话框
 */
export async function openShareModal(window: Page): Promise<boolean> {
  try {
    // 使用evaluate直接触发DOM点击，绕过遮罩层
    const clicked = await window.evaluate(() => {
      const btn = document.querySelector('[data-testid="share-button"]') as HTMLElement;
      if (btn) {
        console.log('[Helper] 找到分享按钮，触发点击');
        btn.click();
        return true;
      }
      console.log('[Helper] 未找到分享按钮');
      return false;
    });

    if (!clicked) {
      console.error('[Helper] Share button not found');
      return false;
    }

    await window.waitForTimeout(500);

    // 验证对话框打开
    const modal = await window.$('.ant-modal');
    return modal !== null;
  } catch (error) {
    console.error('[Helper] Failed to open share modal:', error);
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

    // 强力关闭所有可能的modal（最多尝试5次，使用更激进的方法）
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // 检查是否有可见的modal
        const hasModal = await window.evaluate(() => {
          const modals = document.querySelectorAll('.ant-modal-wrap');
          return Array.from(modals).some((m) => {
            const el = m as HTMLElement;
            return el.style.display !== 'none' && el.offsetParent !== null;
          });
        });

        if (!hasModal) {
          if (attempt > 0) {
            console.log('[Helper] ✅ Modal已成功关闭');
          }
          break;
        }

        console.log(`[Helper] 检测到modal，第${attempt + 1}次尝试关闭...`);

        // 方法1: 使用evaluate直接点击所有关闭按钮
        const closedByButton = await window.evaluate(() => {
          const closeBtns = document.querySelectorAll('.ant-modal-close');
          let clickedCount = 0;
          closeBtns.forEach((btn) => {
            const el = btn as HTMLElement;
            if (el.offsetParent !== null) {
              el.click();
              clickedCount++;
            }
          });
          return clickedCount > 0;
        });

        if (closedByButton) {
          await window.waitForTimeout(500);
          console.log('[Helper] 通过关闭按钮关闭modal');
          continue;
        }

        // 方法2: 按ESC键（多次）
        await window.keyboard.press('Escape');
        await window.waitForTimeout(300);
        await window.keyboard.press('Escape');
        await window.waitForTimeout(300);
        console.log('[Helper] 通过ESC键关闭modal');

        // 方法3: 直接隐藏所有modal（最激进的方法）
        if (attempt >= 2) {
          const hiddenCount = await window.evaluate(() => {
            const modals = document.querySelectorAll('.ant-modal-wrap');
            let count = 0;
            modals.forEach((modal) => {
              const el = modal as HTMLElement;
              if (el.offsetParent !== null) {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
                el.style.opacity = '0';
                el.style.pointerEvents = 'none';
                el.style.zIndex = '-9999';
                count++;
              }
            });
            return count;
          });

          if (hiddenCount > 0) {
            await window.waitForTimeout(500);
            console.log(`[Helper] 通过直接隐藏强制关闭了${hiddenCount}个modal`);
            continue;
          }
        }

        // 方法4: 如果上述方法都失败，直接从DOM中移除modal（最后手段）
        if (attempt >= 3) {
          const removedCount = await window.evaluate(() => {
            const modals = document.querySelectorAll('.ant-modal-wrap');
            let count = 0;
            modals.forEach((modal) => {
              if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
                count++;
              }
            });
            return count;
          });

          if (removedCount > 0) {
            await window.waitForTimeout(500);
            console.log(`[Helper] ⚠️ 从DOM中移除了${removedCount}个modal（最后手段）`);
          }
        }

      } catch (e) {
        console.log(`[Helper] 第${attempt + 1}次关闭尝试失败:`, e);
        // 继续尝试
      }
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
    const clicked = await window.evaluate(() => {
      const switchBtn = document.querySelector('[data-testid="file-tree-mode-switch"]') as HTMLElement;
      if (switchBtn) {
        switchBtn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      console.error('File tree mode switch not found');
      return false;
    }

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

/**
 * 导航到AI创建项目模式
 * @param window - Playwright Page对象
 * @param createData - 可选的创建数据
 * @returns 是否成功导航
 */
export async function navigateToAICreatingMode(
  window: Page,
  createData?: any
): Promise<boolean> {
  try {
    console.log('[Helper] 导航到AI创建模式...');

    // 构建URL
    let url = '#/projects/ai-creating';
    if (createData) {
      const queryString = new URLSearchParams({
        createData: JSON.stringify(createData)
      }).toString();
      url += `?${queryString}`;
    }

    console.log('[Helper] 目标URL:', url);

    // 方法1: 尝试使用window.location.hash
    await window.evaluate((targetUrl) => {
      console.log('[Browser] 设置hash:', targetUrl);
      window.location.hash = targetUrl.replace('#', '');
    }, url);

    await window.waitForTimeout(1000);

    // 检查URL是否改变
    const currentHash = await window.evaluate(() => window.location.hash);
    console.log('[Helper] 当前hash:', currentHash);

    if (!currentHash.includes('ai-creating')) {
      console.warn('[Helper] Hash未改变，尝试强制刷新...');

      // 方法2: 强制触发hashchange事件
      await window.evaluate((targetUrl) => {
        window.location.hash = targetUrl.replace('#', '');
        // 手动触发hashchange事件
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }, url);

      await window.waitForTimeout(1000);
    }

    // 再次检查
    const finalHash = await window.evaluate(() => window.location.hash);
    console.log('[Helper] 最终hash:', finalHash);

    if (!finalHash.includes('ai-creating')) {
      console.error('[Helper] ❌ 无法导航到AI创建模式');
      return false;
    }

    // 等待页面元素出现
    try {
      // 首先等待wrapper出现
      await window.waitForSelector('[data-testid="project-detail-wrapper"]', { timeout: 5000 });
      console.log('[Helper] ✅ 页面wrapper已加载');

      // 然后等待loading状态消失
      try {
        await window.waitForSelector('[data-testid="loading-container"]', { state: 'hidden', timeout: 5000 });
        console.log('[Helper] ✅ Loading状态已消失');
      } catch (e) {
        console.log('[Helper] ℹ️  未检测到loading容器或已经消失');
      }

      // 最后等待content-container出现
      try {
        await window.waitForSelector('[data-testid="content-container"]', { timeout: 5000 });
        console.log('[Helper] ✅ AI创建模式页面已完全加载');
        return true;
      } catch (e) {
        console.error('[Helper] ❌ content-container未出现，调查页面状态...');

        // Debug: 检查页面上有哪些元素
        const hasError = await window.$('[data-testid="error-container"]');
        const hasLoading = await window.$('[data-testid="loading-container"]');
        const hasContent = await window.$('[data-testid="content-container"]');

        console.log('[Helper] Debug - 页面状态:', {
          hasError: !!hasError,
          hasLoading: !!hasLoading,
          hasContent: !!hasContent
        });

        // 检查页面HTML
        const errorContainerText = await window.evaluate(() => {
          const errorDiv = document.querySelector('[data-testid="error-container"]');
          return errorDiv ? errorDiv.innerText : '未找到error-container';
        });
        console.log('[Helper] Debug - 错误容器文本:', errorContainerText);

        return false;
      }
    } catch (error) {
      console.error('[Helper] ❌ 导航过程发生错误:', error);
      return false;
    }

  } catch (error) {
    console.error('[Helper] 导航到AI创建模式失败:', error);
    return false;
  }
}
