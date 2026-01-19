/**
 * 项目 Git 集成 IPC
 * 处理项目的 Git 版本控制操作
 *
 * @module project-git-ipc
 * @description 项目 Git 模块，支持 Git 初始化、提交、推送、拉取、分支管理等
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');
const path = require('path');

/**
 * 注册项目 Git 集成相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.getProjectConfig - 获取项目配置
 * @param {Object} dependencies.GitAPI - Git API 实例
 * @param {Object} dependencies.gitManager - Git 管理器
 * @param {Object} dependencies.fileSyncManager - 文件同步管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 */
function registerProjectGitIPC({
  getProjectConfig,
  GitAPI,
  gitManager,
  fileSyncManager,
  mainWindow
}) {
  logger.info('[Project Git IPC] Registering Project Git IPC handlers...');

  // ============================================================
  // Git 基础操作 (5 handlers)
  // ============================================================

  /**
   * Git 初始化
   * 在项目目录初始化 Git 仓库
   */
  ipcMain.handle('project:git-init', async (_event, repoPath, remoteUrl = null) => {
    try {
      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);

      // 调用后端API
      const result = await GitAPI.init(resolvedPath, remoteUrl);

      // 如果后端不可用，降级到本地Git
      if (!result.success || result.status === 0) {
        logger.warn('[Main] 后端服务不可用，使用本地Git');
        const git = require('isomorphic-git');
        const fs = require('fs');
        await git.init({ fs, dir: resolvedPath, defaultBranch: 'main' });
        return { success: true };
      }

      return result;
    } catch (error) {
      logger.error('[Main] Git初始化失败:', error);
      throw error;
    }
  });

  /**
   * Git 状态查询
   * 获取仓库的当前状态（文件变更、暂存等）
   */
  ipcMain.handle('project:git-status', async (_event, repoPath) => {
    try {
      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);

      // 调用后端API
      const result = await GitAPI.status(resolvedPath);

      // 如果后端不可用，降级到本地Git
      if (!result.success || result.status === 0) {
        logger.warn('[Main] 后端服务不可用，使用本地Git');
        const git = require('isomorphic-git');
        const fs = require('fs');
        const statusMatrix = await git.statusMatrix({ fs, dir: resolvedPath });

        // 将状态矩阵转换为更友好的格式
        const fileStatus = {};
        for (const [filepath, headStatus, worktreeStatus, stageStatus] of statusMatrix) {
          let status = '';
          if (headStatus === 0 && worktreeStatus === 2 && stageStatus === 0) {
            status = 'untracked';
          } else if (headStatus === 1 && worktreeStatus === 2 && stageStatus === 1) {
            status = 'modified';
          } else if (headStatus === 1 && worktreeStatus === 0 && stageStatus === 1) {
            status = 'deleted';
          } else if (headStatus === 0 && worktreeStatus === 2 && stageStatus === 2) {
            status = 'added';
          } else if (headStatus === 1 && worktreeStatus === 2 && stageStatus === 3) {
            status = 'staged';
          }
          if (status) {
            fileStatus[filepath] = status;
          }
        }
        return fileStatus;
      }

      return result.data || {};
    } catch (error) {
      logger.error('[Main] Git状态查询失败:', error);
      throw error;
    }
  });

  /**
   * Git 提交
   * 提交所有变更到本地仓库
   */
  ipcMain.handle('project:git-commit', async (_event, projectId, repoPath, message, autoGenerate = false) => {
    try {
      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      const fs = require('fs');

      // 0. 检查并初始化 Git 仓库（如果需要）
      const gitDir = path.join(resolvedPath, '.git');
      if (!fs.existsSync(gitDir)) {
        logger.info('[Main] Git 仓库未初始化，正在初始化...');
        const git = require('isomorphic-git');
        await git.init({ fs, dir: resolvedPath, defaultBranch: 'main' });
        logger.info('[Main] Git 仓库初始化完成');
      }

      // 1. 提交前：刷新所有数据库更改到文件系统
      logger.info('[Main] Git 提交前，刷新数据库更改到文件系统...');
      if (fileSyncManager && projectId) {
        try {
          await fileSyncManager.flushAllChanges(projectId);
          logger.info('[Main] 文件刷新完成');
        } catch (syncError) {
          logger.warn('[Main] 文件刷新失败（继续提交）:', syncError);
        }
      }

      // 2. 调用后端API
      const author = {
        name: gitManager?.author?.name || 'ChainlessChain User',
        email: gitManager?.author?.email || 'user@chainlesschain.com'
      };
      const result = await GitAPI.commit(resolvedPath, message, author, autoGenerate);

      // 如果后端不可用，降级到本地Git
      if (!result.success || result.status === 0) {
        logger.warn('[Main] 后端服务不可用，使用本地Git');
        const git = require('isomorphic-git');
        const status = await git.statusMatrix({ fs, dir: resolvedPath });

        // 添加所有变更的文件
        let hasChanges = false;
        for (const row of status) {
          const [filepath, , worktreeStatus] = row;
          if (worktreeStatus !== 1) {
            await git.add({ fs, dir: resolvedPath, filepath });
            hasChanges = true;
          }
        }

        // 如果没有变更，返回成功但提示无变更
        if (!hasChanges) {
          logger.info('[Main] 没有需要提交的变更');
          return { success: true, message: 'No changes to commit' };
        }

        // 执行提交
        const sha = await git.commit({ fs, dir: resolvedPath, message, author });
        logger.info('[Main] Git 提交成功:', sha);
        return { success: true, sha };
      }

      logger.info('[Main] Git 提交成功:', result.data?.sha);
      return result;
    } catch (error) {
      logger.error('[Main] Git提交失败:', error);
      throw error;
    }
  });

  /**
   * Git 推送
   * 推送本地提交到远程仓库
   */
  ipcMain.handle('project:git-push', async (_event, repoPath, remote = 'origin', branch = null) => {
    try {
      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);

      // 调用后端API
      const result = await GitAPI.push(resolvedPath, remote, branch);

      // 如果后端不可用，降级到本地Git
      if (!result.success || result.status === 0) {
        logger.warn('[Main] 后端服务不可用，使用本地Git');
        const git = require('isomorphic-git');
        const fs = require('fs');
        const http = require('isomorphic-git/http/node');
        await git.push({
          fs,
          http,
          dir: resolvedPath,
          remote: 'origin',
          ref: 'main',
          onAuth: () => gitManager?.auth || {}
        });
        return { success: true };
      }

      return result;
    } catch (error) {
      logger.error('[Main] Git推送失败:', error);
      throw error;
    }
  });

  /**
   * Git 拉取
   * 从远程仓库拉取最新代码
   */
  ipcMain.handle('project:git-pull', async (_event, projectId, repoPath, remote = 'origin', branch = null) => {
    try {
      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      const fs = require('fs');

      // 0. 检查 Git 仓库是否存在
      const gitDir = path.join(resolvedPath, '.git');
      if (!fs.existsSync(gitDir)) {
        throw new Error('Git 仓库未初始化，请先初始化仓库后再执行 pull 操作');
      }

      // 1. 调用后端API
      logger.info('[Main] 执行 Git pull...');
      const result = await GitAPI.pull(resolvedPath, remote, branch);

      // 如果后端不可用，降级到本地Git
      if (!result.success || result.status === 0) {
        logger.warn('[Main] 后端服务不可用，使用本地Git');
        const git = require('isomorphic-git');
        const http = require('isomorphic-git/http/node');
        await git.pull({
          fs,
          http,
          dir: resolvedPath,
          ref: 'main',
          singleBranch: true,
          onAuth: () => gitManager?.auth || {}
        });
        logger.info('[Main] Git pull 完成');
      } else {
        logger.info('[Main] Git pull 完成');
      }

      // 2. 拉取后：通知前端刷新项目文件列表
      if (mainWindow && projectId) {
        logger.info('[Main] 通知前端刷新项目文件...');
        mainWindow.webContents.send('git:pulled', { projectId });
      }

      return result.success ? result : { success: true };
    } catch (error) {
      logger.error('[Main] Git拉取失败:', error);
      throw error;
    }
  });

  // ============================================================
  // Git 历史与差异 (3 handlers)
  // ============================================================

  /**
   * 获取提交历史
   * 分页获取 Git 提交记录
   */
  ipcMain.handle('project:git-log', async (_event, repoPath, page = 1, pageSize = 20) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      const limit = page * pageSize;

      // 尝试调用后端API
      const result = await GitAPI.log(resolvedPath, limit);

      // 如果后端不可用，降级到本地Git
      if (!result.success || result.status === 0) {
        logger.warn('[Main] 后端服务不可用，使用本地Git获取提交历史');
        const git = require('isomorphic-git');
        const fs = require('fs');

        // 使用本地 Git 获取提交历史
        const commits = await git.log({
          fs,
          dir: resolvedPath,
          depth: limit,
        });

        // 转换为统一格式（保持与组件期望的数据结构一致）
        const formattedCommits = commits.map(commit => ({
          sha: commit.oid,
          oid: commit.oid,
          message: commit.commit.message,
          timestamp: commit.commit.author.timestamp,  // 顶层时间戳，便于访问
          author: commit.commit.author.name,          // 顶层作者名，便于显示
          commit: {                                   // 保留嵌套结构作为后备
            message: commit.commit.message,
            author: {
              name: commit.commit.author.name,
              email: commit.commit.author.email,
              timestamp: commit.commit.author.timestamp,
            },
            committer: {
              name: commit.commit.committer.name,
              email: commit.commit.committer.email,
              timestamp: commit.commit.committer.timestamp,
            }
          }
        }));

        // 分页处理
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedCommits = formattedCommits.slice(startIndex, endIndex);

        return {
          success: true,
          commits: paginatedCommits,
          hasMore: formattedCommits.length >= limit,
        };
      }

      // 后端可用，返回分页结果
      if (result && result.commits) {
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedCommits = result.commits.slice(startIndex, endIndex);

        return {
          ...result,
          commits: paginatedCommits,
          hasMore: result.commits.length >= limit
        };
      }

      return result;
    } catch (error) {
      logger.error('[Main] 获取提交历史失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取提交详情
   * 查看指定提交的详细信息和差异
   */
  ipcMain.handle('project:git-show-commit', async (_event, repoPath, sha) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      // Get the diff for a specific commit (commit vs its parent)
      const result = await GitAPI.diff(resolvedPath, sha + '^', sha);
      return result;
    } catch (error) {
      logger.error('[Main] 获取提交详情失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取差异
   * 比较两个提交之间的文件差异
   */
  ipcMain.handle('project:git-diff', async (_event, repoPath, commit1 = null, commit2 = null) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await GitAPI.diff(resolvedPath, commit1, commit2);
    } catch (error) {
      logger.error('[Main] 获取差异失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Git 分支管理 (6 handlers)
  // ============================================================

  /**
   * 获取分支列表
   * 列出所有本地和远程分支
   */
  ipcMain.handle('project:git-branches', async (_event, repoPath) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await GitAPI.branches(resolvedPath);
    } catch (error) {
      logger.error('[Main] 获取分支列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建分支
   * 从指定分支创建新分支
   */
  ipcMain.handle('project:git-create-branch', async (_event, repoPath, branchName, fromBranch = null) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await GitAPI.createBranch(resolvedPath, branchName, fromBranch);
    } catch (error) {
      logger.error('[Main] 创建分支失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 切换分支
   * 检出指定的分支
   */
  ipcMain.handle('project:git-checkout', async (_event, repoPath, branchName) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await GitAPI.checkoutBranch(resolvedPath, branchName);
    } catch (error) {
      logger.error('[Main] 切换分支失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 合并分支
   * 将源分支合并到目标分支
   */
  ipcMain.handle('project:git-merge', async (_event, repoPath, sourceBranch, targetBranch = null) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await GitAPI.merge(resolvedPath, sourceBranch, targetBranch);
    } catch (error) {
      logger.error('[Main] 合并分支失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 解决冲突
   * 自动或手动解决合并冲突
   */
  ipcMain.handle('project:git-resolve-conflicts', async (_event, repoPath, filePath = null, strategy = null) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await GitAPI.resolveConflicts(resolvedPath, filePath, false, strategy);
    } catch (error) {
      logger.error('[Main] 解决冲突失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 生成提交消息
   * 使用 AI 根据变更自动生成提交消息
   */
  ipcMain.handle('project:git-generate-commit-message', async (_event, repoPath) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await GitAPI.generateCommitMessage(resolvedPath);
    } catch (error) {
      logger.error('[Main] 生成提交消息失败:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[Project Git IPC] ✓ 14 handlers registered');
  logger.info('[Project Git IPC] - 5 basic Git operation handlers');
  logger.info('[Project Git IPC] - 3 history & diff handlers');
  logger.info('[Project Git IPC] - 6 branch management handlers');
}

module.exports = {
  registerProjectGitIPC
};
