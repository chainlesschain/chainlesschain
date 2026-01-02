/**
 * Git IPC 处理器
 * 负责处理 Git 版本控制相关的前后端通信
 *
 * @module git-ipc
 * @description 提供 Git 同步、冲突解决、配置管理、Markdown 导出、AI 提交信息生成等 IPC 接口
 */

const { ipcMain } = require('electron');

/**
 * 注册所有 Git IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} [dependencies.gitManager] - Git 管理器
 * @param {Object} [dependencies.markdownExporter] - Markdown 导出器
 * @param {Function} dependencies.getGitConfig - 获取 Git 配置函数
 * @param {Object} [dependencies.llmManager] - LLM 管理器（用于 AI 提交信息生成）
 */
function registerGitIPC({ gitManager, markdownExporter, getGitConfig, llmManager }) {
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
        // 重启应用以应用新配置
        // TODO: 实现热重载
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

  console.log('[Git IPC] ✓ All Git IPC handlers registered successfully (16 handlers)');
}

module.exports = {
  registerGitIPC
};
