/**
 * Git 同步管理器
 *
 * 使用 isomorphic-git 实现Git功能
 */

const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');
const http = require('isomorphic-git/http/node');
const { app } = require('electron');
const EventEmitter = require('events');

/**
 * Git管理器类
 *
 * 功能：
 * - 初始化仓库
 * - 克隆远程仓库
 * - 提交更改
 * - 推送到远程
 * - 拉取远程更新
 * - 状态查询
 */
class GitManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.repoPath = config.repoPath || this.getDefaultRepoPath();
    this.isInitialized = false;

    // Git 用户信息
    this.author = {
      name: config.authorName || 'ChainlessChain User',
      email: config.authorEmail || 'user@chainlesschain.com',
    };

    // 远程仓库配置
    this.remote = {
      name: 'origin',
      url: config.remoteUrl || null,
    };

    // 认证信息
    this.auth = config.auth || null;
  }

  /**
   * 获取默认仓库路径
   */
  getDefaultRepoPath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'git-repo');
  }

  /**
   * 初始化Git管理器
   */
  async initialize() {
    console.log('[GitManager] 初始化Git管理器...');
    console.log('[GitManager] 仓库路径:', this.repoPath);

    try {
      // 确保目录存在
      if (!fs.existsSync(this.repoPath)) {
        fs.mkdirSync(this.repoPath, { recursive: true });
      }

      // 检查是否已经是git仓库
      const isRepo = await this.isGitRepository();

      if (!isRepo) {
        console.log('[GitManager] 初始化新的Git仓库...');
        await git.init({
          fs,
          dir: this.repoPath,
          defaultBranch: 'main',
        });
        console.log('[GitManager] Git仓库初始化成功');
      } else {
        console.log('[GitManager] 使用现有Git仓库');
      }

      this.isInitialized = true;
      this.emit('initialized');

      return true;
    } catch (error) {
      console.error('[GitManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 检查是否是Git仓库
   */
  async isGitRepository() {
    try {
      const gitDir = path.join(this.repoPath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取仓库状态
   */
  async getStatus() {
    try {
      if (!this.isInitialized) {
        throw new Error('Git管理器未初始化');
      }

      // 获取当前分支
      const branch = await git.currentBranch({
        fs,
        dir: this.repoPath,
        fullname: false,
      }) || 'main';

      // 获取状态矩阵
      const statusMatrix = await git.statusMatrix({
        fs,
        dir: this.repoPath,
      });

      // 分类文件
      const modified = [];
      const untracked = [];
      const deleted = [];

      for (const [filepath, head, workdir, stage] of statusMatrix) {
        if (head === 1 && workdir === 2 && stage === 2) {
          modified.push(filepath);
        } else if (head === 0 && workdir === 2 && stage === 0) {
          untracked.push(filepath);
        } else if (head === 1 && workdir === 0) {
          deleted.push(filepath);
        }
      }

      // 获取最后同步时间
      const lastSync = await this.getLastCommitDate();

      return {
        branch,
        ahead: 0, // TODO: 计算ahead commits
        behind: 0, // TODO: 计算behind commits
        modified,
        untracked,
        deleted,
        lastSync,
      };
    } catch (error) {
      console.error('[GitManager] 获取状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取最后提交时间
   */
  async getLastCommitDate() {
    try {
      const commits = await git.log({
        fs,
        dir: this.repoPath,
        depth: 1,
      });

      if (commits.length > 0) {
        return new Date(commits[0].commit.committer.timestamp * 1000);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 添加文件到暂存区
   * @param {string|string[]} filepaths - 文件路径
   */
  async add(filepaths) {
    try {
      const paths = Array.isArray(filepaths) ? filepaths : [filepaths];

      for (const filepath of paths) {
        await git.add({
          fs,
          dir: this.repoPath,
          filepath,
        });
      }

      console.log('[GitManager] 文件已添加到暂存区:', paths);
      this.emit('files-added', paths);

      return true;
    } catch (error) {
      console.error('[GitManager] 添加文件失败:', error);
      throw error;
    }
  }

  /**
   * 提交更改
   * @param {string} message - 提交消息
   */
  async commit(message) {
    try {
      const sha = await git.commit({
        fs,
        dir: this.repoPath,
        message,
        author: this.author,
      });

      console.log('[GitManager] 提交成功:', sha);
      this.emit('committed', { sha, message });

      return sha;
    } catch (error) {
      console.error('[GitManager] 提交失败:', error);
      throw error;
    }
  }

  /**
   * 推送到远程仓库
   */
  async push() {
    try {
      if (!this.remote.url) {
        throw new Error('未配置远程仓库');
      }

      const pushResult = await git.push({
        fs,
        http,
        dir: this.repoPath,
        remote: this.remote.name,
        onAuth: () => this.auth,
        onProgress: (progress) => {
          this.emit('push-progress', progress);
        },
      });

      console.log('[GitManager] 推送成功');
      this.emit('pushed', pushResult);

      return pushResult;
    } catch (error) {
      console.error('[GitManager] 推送失败:', error);
      throw error;
    }
  }

  /**
   * 从远程仓库拉取
   */
  async pull() {
    try {
      if (!this.remote.url) {
        throw new Error('未配置远程仓库');
      }

      // 先fetch
      await git.fetch({
        fs,
        http,
        dir: this.repoPath,
        remote: this.remote.name,
        onAuth: () => this.auth,
        onProgress: (progress) => {
          this.emit('pull-progress', progress);
        },
      });

      // 再merge
      await git.merge({
        fs,
        dir: this.repoPath,
        ours: await git.currentBranch({ fs, dir: this.repoPath }),
        theirs: `${this.remote.name}/main`,
        author: this.author,
      });

      console.log('[GitManager] 拉取成功');
      this.emit('pulled');

      return true;
    } catch (error) {
      console.error('[GitManager] 拉取失败:', error);
      throw error;
    }
  }

  /**
   * 克隆远程仓库
   * @param {string} url - 远程仓库URL
   * @param {string} targetPath - 目标路径
   */
  async clone(url, targetPath = null) {
    try {
      const clonePath = targetPath || this.repoPath;

      console.log('[GitManager] 克隆仓库:', url);

      await git.clone({
        fs,
        http,
        dir: clonePath,
        url,
        onAuth: () => this.auth,
        onProgress: (progress) => {
          this.emit('clone-progress', progress);
        },
      });

      console.log('[GitManager] 克隆成功');
      this.emit('cloned', { url, path: clonePath });

      return true;
    } catch (error) {
      console.error('[GitManager] 克隆失败:', error);
      throw error;
    }
  }

  /**
   * 配置远程仓库
   * @param {string} url - 远程仓库URL
   * @param {string} name - 远程仓库名称
   */
  async setRemote(url, name = 'origin') {
    try {
      await git.addRemote({
        fs,
        dir: this.repoPath,
        remote: name,
        url,
      });

      this.remote = { name, url };

      console.log('[GitManager] 远程仓库已配置:', url);
      this.emit('remote-configured', { name, url });

      return true;
    } catch (error) {
      // 如果远程已存在，尝试更新
      try {
        await git.deleteRemote({
          fs,
          dir: this.repoPath,
          remote: name,
        });

        await git.addRemote({
          fs,
          dir: this.repoPath,
          remote: name,
          url,
        });

        this.remote = { name, url };
        return true;
      } catch (updateError) {
        console.error('[GitManager] 配置远程仓库失败:', updateError);
        throw updateError;
      }
    }
  }

  /**
   * 设置认证信息
   * @param {Object} auth - 认证信息
   */
  setAuth(auth) {
    this.auth = auth;
    console.log('[GitManager] 认证信息已更新');
  }

  /**
   * 设置作者信息
   * @param {string} name - 作者名称
   * @param {string} email - 作者邮箱
   */
  setAuthor(name, email) {
    this.author = { name, email };
    console.log('[GitManager] 作者信息已更新:', this.author);
  }

  /**
   * 获取提交历史
   * @param {number} depth - 深度
   */
  async getLog(depth = 10) {
    try {
      const commits = await git.log({
        fs,
        dir: this.repoPath,
        depth,
      });

      return commits.map((commit) => ({
        sha: commit.oid,
        message: commit.commit.message,
        author: commit.commit.author,
        timestamp: new Date(commit.commit.author.timestamp * 1000),
      }));
    } catch (error) {
      console.error('[GitManager] 获取日志失败:', error);
      return [];
    }
  }

  /**
   * 检查是否有未提交的更改
   */
  async hasUncommittedChanges() {
    try {
      const status = await this.getStatus();
      return (
        status.modified.length > 0 ||
        status.untracked.length > 0 ||
        status.deleted.length > 0
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * 自动同步
   * - 添加所有更改
   * - 提交
   * - 推送
   */
  async autoSync(message = 'Auto sync') {
    try {
      console.log('[GitManager] 开始自动同步...');

      // 获取状态
      const status = await this.getStatus();

      // 添加所有更改
      const allFiles = [
        ...status.modified,
        ...status.untracked,
        ...status.deleted,
      ];

      if (allFiles.length === 0) {
        console.log('[GitManager] 没有更改需要同步');
        return { synced: false, message: '没有更改' };
      }

      // 添加所有文件
      for (const file of allFiles) {
        await this.add(file);
      }

      // 提交
      const sha = await this.commit(message);

      // 推送（如果配置了远程）
      if (this.remote.url) {
        await this.push();
      }

      console.log('[GitManager] 自动同步完成');
      this.emit('auto-synced', { sha, files: allFiles.length });

      return {
        synced: true,
        sha,
        filesCount: allFiles.length,
      };
    } catch (error) {
      console.error('[GitManager] 自动同步失败:', error);
      throw error;
    }
  }

  /**
   * 关闭管理器
   */
  async close() {
    console.log('[GitManager] 关闭Git管理器');
    this.isInitialized = false;
    this.emit('closed');
  }
}

module.exports = GitManager;
