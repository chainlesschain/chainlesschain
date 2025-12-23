/**
 * Git自动提交模块
 * 自动检测文件更改并定期提交
 */

const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');
const { gitLog, gitError } = require('./git/git-config');

class GitAutoCommit {
  constructor(options = {}) {
    this.interval = options.interval || 5 * 60 * 1000; // 默认5分钟
    this.enabled = options.enabled !== false; // 默认启用
    this.watchedProjects = new Map(); // projectId -> { path, timer }
    this.author = options.author || {
      name: 'ChainlessChain',
      email: 'auto-commit@chainlesschain.com',
    };
  }

  /**
   * 启动自动提交
   * @param {string} projectId - 项目ID
   * @param {string} repoPath - 仓库路径
   */
  start(projectId, repoPath) {
    if (!this.enabled) {
      gitLog('Git Auto Commit', '自动提交已禁用');
      return;
    }

    // 如果已经在监视，先停止
    if (this.watchedProjects.has(projectId)) {
      this.stop(projectId);
    }

    gitLog('Git Auto Commit', `开始监视项目: ${projectId} (${repoPath})`);

    // 启动定时器
    const timer = setInterval(async () => {
      await this.checkAndCommit(projectId, repoPath);
    }, this.interval);

    this.watchedProjects.set(projectId, {
      path: repoPath,
      timer,
    });

    // 立即执行一次检查
    this.checkAndCommit(projectId, repoPath);
  }

  /**
   * 停止自动提交
   * @param {string} projectId - 项目ID
   */
  stop(projectId) {
    const project = this.watchedProjects.get(projectId);

    if (project) {
      clearInterval(project.timer);
      this.watchedProjects.delete(projectId);
      gitLog('Git Auto Commit', `停止监视项目: ${projectId}`);
    }
  }

  /**
   * 停止所有自动提交
   */
  stopAll() {
    gitLog('Git Auto Commit', '停止所有自动提交');

    for (const [projectId, project] of this.watchedProjects) {
      clearInterval(project.timer);
    }

    this.watchedProjects.clear();
  }

  /**
   * 检查并提交更改
   * @param {string} projectId - 项目ID
   * @param {string} repoPath - 仓库路径
   * @private
   */
  async checkAndCommit(projectId, repoPath) {
    try {
      gitLog('Git Auto Commit', `检查项目 ${projectId} 的更改...`);

      // 检查是否是Git仓库
      const isRepo = await this.isGitRepository(repoPath);

      if (!isRepo) {
        gitLog('Git Auto Commit', `${repoPath} 不是Git仓库，跳过`);
        return;
      }

      // 获取状态
      const status = await this.getStatus(repoPath);

      // 如果没有更改，跳过
      if (status.clean) {
        gitLog('Git Auto Commit', `项目 ${projectId} 无更改`);
        return;
      }

      gitLog('Git Auto Commit', '发现更改:', {
        modified: status.modified.length,
        added: status.added.length,
        deleted: status.deleted.length,
      });

      // 添加所有更改
      await this.addAll(repoPath);

      // 提交
      const commitMessage = this.generateCommitMessage(status);
      await this.commit(repoPath, commitMessage);

      gitLog('Git Auto Commit', `自动提交成功: ${commitMessage}`);
    } catch (error) {
      gitError('Git Auto Commit', '自动提交失败:', error);
    }
  }

  /**
   * 检查是否是Git仓库
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<boolean>}
   * @private
   */
  async isGitRepository(repoPath) {
    try {
      const gitDir = path.join(repoPath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取Git状态
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 状态对象
   * @private
   */
  async getStatus(repoPath) {
    try {
      const FILE = 0;
      const WORKDIR = 2;
      const STAGE = 3;

      const statusMatrix = await git.statusMatrix({
        fs,
        dir: repoPath,
      });

      const modified = [];
      const added = [];
      const deleted = [];
      const untracked = [];

      for (const [filepath, head, workdir, stage] of statusMatrix) {
        // 未跟踪的文件
        if (head === 0 && workdir === 2 && stage === 0) {
          untracked.push(filepath);
        }
        // 修改的文件
        else if (head === 1 && workdir === 2 && stage === 1) {
          modified.push(filepath);
        }
        // 新增的文件
        else if (head === 0 && workdir === 2 && stage === 2) {
          added.push(filepath);
        }
        // 删除的文件
        else if (head === 1 && workdir === 0 && stage === 1) {
          deleted.push(filepath);
        }
        // 已暂存的修改
        else if (head === 1 && workdir === 2 && stage === 2) {
          modified.push(filepath);
        }
      }

      const clean = modified.length === 0 &&
                    added.length === 0 &&
                    deleted.length === 0 &&
                    untracked.length === 0;

      return {
        clean,
        modified,
        added,
        deleted,
        untracked,
      };
    } catch (error) {
      gitError('Git Auto Commit', '获取状态失败:', error);
      throw error;
    }
  }

  /**
   * 添加所有更改
   * @param {string} repoPath - 仓库路径
   * @private
   */
  async addAll(repoPath) {
    try {
      // 获取所有文件
      const status = await this.getStatus(repoPath);

      // 添加所有更改的文件
      for (const filepath of [...status.modified, ...status.added, ...status.untracked]) {
        await git.add({
          fs,
          dir: repoPath,
          filepath,
        });
      }

      // 处理删除的文件
      for (const filepath of status.deleted) {
        await git.remove({
          fs,
          dir: repoPath,
          filepath,
        });
      }
    } catch (error) {
      gitError('Git Auto Commit', '添加文件失败:', error);
      throw error;
    }
  }

  /**
   * 提交更改
   * @param {string} repoPath - 仓库路径
   * @param {string} message - 提交消息
   * @private
   */
  async commit(repoPath, message) {
    try {
      const sha = await git.commit({
        fs,
        dir: repoPath,
        author: this.author,
        message,
      });

      return sha;
    } catch (error) {
      gitError('Git Auto Commit', '提交失败:', error);
      throw error;
    }
  }

  /**
   * 生成提交消息
   * @param {Object} status - Git状态
   * @returns {string} 提交消息
   * @private
   */
  generateCommitMessage(status) {
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const changes = [];

    if (status.modified.length > 0) {
      changes.push(`${status.modified.length} 个文件修改`);
    }

    if (status.added.length > 0) {
      changes.push(`${status.added.length} 个文件新增`);
    }

    if (status.untracked.length > 0) {
      changes.push(`${status.untracked.length} 个未跟踪文件`);
    }

    if (status.deleted.length > 0) {
      changes.push(`${status.deleted.length} 个文件删除`);
    }

    const summary = changes.join(', ');

    return `Auto-commit: ${timestamp}\n\n${summary}`;
  }

  /**
   * 设置提交间隔
   * @param {number} interval - 间隔时间（毫秒）
   */
  setInterval(interval) {
    this.interval = interval;
    gitLog('Git Auto Commit', `设置提交间隔: ${interval}ms`);

    // 重启所有监视
    const projects = Array.from(this.watchedProjects.entries());

    for (const [projectId, project] of projects) {
      this.stop(projectId);
      this.start(projectId, project.path);
    }
  }

  /**
   * 启用/禁用自动提交
   * @param {boolean} enabled - 是否启用
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    gitLog('Git Auto Commit', `${enabled ? '启用' : '禁用'}自动提交`);

    if (!enabled) {
      this.stopAll();
    }
  }

  /**
   * 设置提交作者信息
   * @param {Object} author - 作者信息
   */
  setAuthor(author) {
    this.author = author;
    gitLog('Git Auto Commit', '设置作者:', author);
  }

  /**
   * 获取监视的项目列表
   * @returns {Array} 项目列表
   */
  getWatchedProjects() {
    return Array.from(this.watchedProjects.keys());
  }
}

module.exports = GitAutoCommit;
