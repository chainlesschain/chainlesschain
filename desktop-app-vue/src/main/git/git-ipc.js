/**
 * Git IPC 处理器
 * 负责处理 Git 版本控制相关的前后端通信
 *
 * @module git-ipc
 * @description 提供 Git 同步、冲突解决、配置管理、Markdown 导出、AI 提交信息生成等 IPC 接口
 */

const { ipcMain } = require('electron');
const ipcGuard = require('../ipc-guard');

/**
 * 注册所有 Git IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} [dependencies.gitManager] - Git 管理器
 * @param {Object} [dependencies.markdownExporter] - Markdown 导出器
 * @param {Function} dependencies.getGitConfig - 获取 Git 配置函数
 * @param {Object} [dependencies.llmManager] - LLM 管理器（用于 AI 提交信息生成）
 * @param {Object} [dependencies.gitHotReload] - Git 热重载管理器
 * @param {Object} [dependencies.mainWindow] - 主窗口对象（用于发送事件）
 */
function registerGitIPC({ gitManager, markdownExporter, getGitConfig, llmManager, gitHotReload, mainWindow }) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered('git-ipc')) {
    console.log('[Git IPC] Handlers already registered, skipping...');
    return;
  }

  console.log('[Git IPC] Registering Git IPC handlers...');

  // ============================================================
  // Git 基础操作 (Basic Operations)
  // ============================================================

  /**
   * 获取 Git 状态
   * Channel: 'git:status'
   */
  ipcMain.handle('git:status', async () => {
    try {
      if (!gitManager) {
        return {
          enabled: false,
          error: 'Git同步未启用',
        };
      }

      const status = await gitManager.getStatus();
      return {
        enabled: true,
        ...status,
      };
    } catch (error) {
      console.error('[Git IPC] 获取Git状态失败:', error);
      return {
        enabled: false,
        error: error.message,
      };
    }
  });

  /**
   * 同步 Git（导出 + 自动同步）
   * Channel: 'git:sync'
   */
  ipcMain.handle('git:sync', async () => {
    try {
      if (!gitManager || !markdownExporter) {
        throw new Error('Git同步未启用');
      }

      // 导出数据
      await markdownExporter.sync();

      // 同步Git
      const result = await gitManager.autoSync('Manual sync from ChainlessChain');

      return result;
    } catch (error) {
      console.error('[Git IPC] Git同步失败:', error);
      throw error;
    }
  });

  /**
   * 推送到远程仓库
   * Channel: 'git:push'
   */
  ipcMain.handle('git:push', async () => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      await gitManager.push();
      return true;
    } catch (error) {
      console.error('[Git IPC] Git推送失败:', error);
      throw error;
    }
  });

  /**
   * 从远程仓库拉取
   * Channel: 'git:pull'
   */
  ipcMain.handle('git:pull', async () => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      const result = await gitManager.pull();
      return result;
    } catch (error) {
      console.error('[Git IPC] Git拉取失败:', error);
      throw error;
    }
  });

  /**
   * 克隆远程仓库
   * Channel: 'git:clone'
   */
  ipcMain.handle('git:clone', async (_event, url, targetPath, auth) => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      // 如果提供了认证信息，临时设置
      if (auth) {
        gitManager.setAuth(auth);
      }

      await gitManager.clone(url, targetPath);
      return { success: true, path: targetPath };
    } catch (error) {
      console.error('[Git IPC] Git克隆失败:', error);
      throw error;
    }
  });

  /**
   * 获取 Git 日志
   * Channel: 'git:get-log'
   */
  ipcMain.handle('git:get-log', async (_event, depth = 10) => {
    try {
      if (!gitManager) {
        return [];
      }

      return await gitManager.getLog(depth);
    } catch (error) {
      console.error('[Git IPC] 获取Git日志失败:', error);
      throw error;
    }
  });

  // ============================================================
  // Git 冲突解决 (Conflict Resolution)
  // ============================================================

  /**
   * 获取冲突文件列表
   * Channel: 'git:get-conflicts'
   */
  ipcMain.handle('git:get-conflicts', async () => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      return await gitManager.getConflictFiles();
    } catch (error) {
      console.error('[Git IPC] 获取冲突文件失败:', error);
      throw error;
    }
  });

  /**
   * 获取冲突文件内容
   * Channel: 'git:get-conflict-content'
   */
  ipcMain.handle('git:get-conflict-content', async (_event, filepath) => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      return await gitManager.getConflictContent(filepath);
    } catch (error) {
      console.error('[Git IPC] 获取冲突内容失败:', error);
      throw error;
    }
  });

  /**
   * 解决冲突
   * Channel: 'git:resolve-conflict'
   */
  ipcMain.handle('git:resolve-conflict', async (_event, filepath, resolution, content) => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      return await gitManager.resolveConflict(filepath, resolution, content);
    } catch (error) {
      console.error('[Git IPC] 解决冲突失败:', error);
      throw error;
    }
  });

  /**
   * 中止合并
   * Channel: 'git:abort-merge'
   */
  ipcMain.handle('git:abort-merge', async () => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      return await gitManager.abortMerge();
    } catch (error) {
      console.error('[Git IPC] 中止合并失败:', error);
      throw error;
    }
  });

  /**
   * 完成合并
   * Channel: 'git:complete-merge'
   */
  ipcMain.handle('git:complete-merge', async (_event, message) => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      return await gitManager.completeMerge(message);
    } catch (error) {
      console.error('[Git IPC] 完成合并失败:', error);
      throw error;
    }
  });

  // ============================================================
  // Git 配置管理 (Configuration)
  // ============================================================

  /**
   * 获取 Git 配置
   * Channel: 'git:get-config'
   */
  ipcMain.handle('git:get-config', async () => {
    try {
      const gitConfig = getGitConfig();
      return gitConfig.getAll();
    } catch (error) {
      console.error('[Git IPC] 获取Git配置失败:', error);
      throw error;
    }
  });

  /**
   * 获取同步状态
   * Channel: 'git:get-sync-status'
   */
  ipcMain.handle('git:get-sync-status', async () => {
    try {
      const gitConfig = getGitConfig();
      const config = gitConfig.getAll();

      return {
        enabled: config.enabled || false,
        autoCommit: config.autoCommit || false,
        autoSync: config.autoSync || false,
        syncInterval: config.syncInterval || 300000,
        lastSyncTime: config.lastSyncTime || null,
        repoPath: config.repoPath || null,
        remoteUrl: config.remoteUrl || null,
      };
    } catch (error) {
      console.error('[Git IPC] 获取同步状态失败:', error);
      throw error;
    }
  });

  /**
   * 设置 Git 配置
   * Channel: 'git:set-config'
   */
  ipcMain.handle('git:set-config', async (_event, config) => {
    try {
      const gitConfig = getGitConfig();

      // 更新配置
      Object.keys(config).forEach((key) => {
        gitConfig.set(key, config[key]);
      });

      gitConfig.save();

      // 如果启用状态改变，需要重新初始化
      if ('enabled' in config) {
        // 热重载Git管理器
        if (config.enabled && !gitManager) {
          // 启用Git - 初始化管理器
          const GitManager = require('./git-manager');
          gitManager = new GitManager({
            repoPath: gitConfig.getRepoPath(),
            autoCommit: gitConfig.isAutoCommitEnabled(),
            autoCommitInterval: gitConfig.getAutoCommitInterval(),
            remoteUrl: gitConfig.getRemoteUrl(),
            auth: gitConfig.getAuth()
          });
          await gitManager.initialize();
          console.log('[Git IPC] Git管理器已启用（热重载）');
        } else if (!config.enabled && gitManager) {
          // 禁用Git - 关闭管理器
          await gitManager.close();
          gitManager = null;
          console.log('[Git IPC] Git管理器已禁用（热重载）');
        }
      }

      return true;
    } catch (error) {
      console.error('[Git IPC] 设置Git配置失败:', error);
      throw error;
    }
  });

  /**
   * 设置远程仓库 URL
   * Channel: 'git:set-remote'
   */
  ipcMain.handle('git:set-remote', async (_event, url) => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      await gitManager.setRemote(url);

      // 更新配置
      const gitConfig = getGitConfig();
      gitConfig.setRemoteUrl(url);

      return true;
    } catch (error) {
      console.error('[Git IPC] 设置远程仓库失败:', error);
      throw error;
    }
  });

  /**
   * 设置认证信息
   * Channel: 'git:set-auth'
   */
  ipcMain.handle('git:set-auth', async (_event, auth) => {
    try {
      if (!gitManager) {
        throw new Error('Git同步未启用');
      }

      gitManager.setAuth(auth);

      // 更新配置
      const gitConfig = getGitConfig();
      gitConfig.setAuth(auth);

      return true;
    } catch (error) {
      console.error('[Git IPC] 设置认证信息失败:', error);
      throw error;
    }
  });

  // ============================================================
  // Markdown 导出 (Markdown Export)
  // ============================================================

  /**
   * 导出所有数据为 Markdown
   * Channel: 'git:export-markdown'
   */
  ipcMain.handle('git:export-markdown', async () => {
    try {
      if (!markdownExporter) {
        throw new Error('Markdown导出器未初始化');
      }

      const files = await markdownExporter.exportAll();
      return files;
    } catch (error) {
      console.error('[Git IPC] 导出Markdown失败:', error);
      throw error;
    }
  });

  // ============================================================
  // AI 提交信息生成 (AI Commit Message)
  // ============================================================

  /**
   * AI 生成提交信息
   * Channel: 'git:generateCommitMessage'
   */
  ipcMain.handle('git:generateCommitMessage', async (_event, projectPath) => {
    try {
      const AICommitMessageGenerator = require('./ai-commit-message');
      const generator = new AICommitMessageGenerator(llmManager);

      const result = await generator.generateCommitMessage(projectPath);

      console.log('[Git IPC] AI生成提交信息成功');
      return result;
    } catch (error) {
      console.error('[Git IPC] AI生成提交信息失败:', error);
      throw error;
    }
  });

  // ============================================================
  // Git 热重载 (Hot Reload)
  // ============================================================

  /**
   * 启动 Git 热重载
   * Channel: 'git:hot-reload:start'
   */
  ipcMain.handle('git:hot-reload:start', async () => {
    try {
      if (!gitHotReload) {
        throw new Error('Git热重载未初始化');
      }

      gitHotReload.start();
      return { success: true };
    } catch (error) {
      console.error('[Git IPC] 启动Git热重载失败:', error);
      throw error;
    }
  });

  /**
   * 停止 Git 热重载
   * Channel: 'git:hot-reload:stop'
   */
  ipcMain.handle('git:hot-reload:stop', async () => {
    try {
      if (!gitHotReload) {
        throw new Error('Git热重载未初始化');
      }

      await gitHotReload.stop();
      return { success: true };
    } catch (error) {
      console.error('[Git IPC] 停止Git热重载失败:', error);
      throw error;
    }
  });

  /**
   * 获取 Git 热重载状态
   * Channel: 'git:hot-reload:status'
   */
  ipcMain.handle('git:hot-reload:status', async () => {
    try {
      if (!gitHotReload) {
        return {
          enabled: false,
          watching: false,
          error: 'Git热重载未初始化'
        };
      }

      return gitHotReload.getStatus();
    } catch (error) {
      console.error('[Git IPC] 获取Git热重载状态失败:', error);
      throw error;
    }
  });

  /**
   * 手动刷新 Git 状态
   * Channel: 'git:hot-reload:refresh'
   */
  ipcMain.handle('git:hot-reload:refresh', async () => {
    try {
      if (!gitHotReload) {
        throw new Error('Git热重载未初始化');
      }

      await gitHotReload.refresh();
      return { success: true };
    } catch (error) {
      console.error('[Git IPC] 刷新Git状态失败:', error);
      throw error;
    }
  });

  /**
   * 设置 Git 热重载配置
   * Channel: 'git:hot-reload:configure'
   */
  ipcMain.handle('git:hot-reload:configure', async (_event, config) => {
    try {
      if (!gitHotReload) {
        throw new Error('Git热重载未初始化');
      }

      if (config.enabled !== undefined) {
        gitHotReload.setEnabled(config.enabled);
      }

      if (config.debounceDelay !== undefined) {
        gitHotReload.setDebounceDelay(config.debounceDelay);
      }

      return { success: true };
    } catch (error) {
      console.error('[Git IPC] 配置Git热重载失败:', error);
      throw error;
    }
  });

  // ============================================================
  // Git 热重载事件转发（从主进程到渲染进程）
  // ============================================================

  if (gitHotReload && mainWindow) {
    // 文件变化事件
    gitHotReload.on('file-changed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:file-changed', data);
      }
    });

    // 状态变化事件
    gitHotReload.on('status-changed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:status-changed', data);
      }
    });

    // 错误事件
    gitHotReload.on('error', (error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:hot-reload:error', {
          message: error.message,
          stack: error.stack
        });
      }
    });

    // 就绪事件
    gitHotReload.on('ready', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:hot-reload:ready');
      }
    });

    // 启动/停止事件
    gitHotReload.on('started', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:hot-reload:started');
      }
    });

    gitHotReload.on('stopped', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:hot-reload:stopped');
      }
    });
  }

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('git-ipc');

  console.log('[Git IPC] ✓ All Git IPC handlers registered successfully (23 handlers)');
}

module.exports = {
  registerGitIPC
};
