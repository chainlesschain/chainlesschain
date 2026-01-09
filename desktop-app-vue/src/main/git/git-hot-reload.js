/**
 * Git Hot Reload Module
 * 监听Git仓库文件变化，实时通知前端更新
 *
 * 功能：
 * - 监听仓库文件变化（使用chokidar）
 * - 防抖处理，避免频繁触发
 * - 自动检测Git状态变化
 * - 通知前端更新UI
 */

const chokidar = require('chokidar');
const path = require('path');
const EventEmitter = require('events');
const { gitLog, gitWarn, gitError } = require('./git-config');

class GitHotReload extends EventEmitter {
  constructor(gitManager, options = {}) {
    super();

    this.gitManager = gitManager;
    this.repoPath = gitManager.repoPath;
    this.enabled = options.enabled !== false;

    // 防抖配置
    this.debounceDelay = options.debounceDelay || 1000; // 1秒防抖
    this.debounceTimer = null;

    // 文件监听器
    this.watcher = null;

    // 上次状态缓存
    this.lastStatus = null;

    // 忽略的文件模式
    this.ignorePatterns = [
      '**/.git/**',
      '**/node_modules/**',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.tmp',
      '**/*.temp',
      ...(options.ignorePatterns || [])
    ];

    gitLog('GitHotReload', '初始化Git热重载模块');
  }

  /**
   * 启动文件监听
   */
  start() {
    if (!this.enabled) {
      gitLog('GitHotReload', 'Git热重载已禁用');
      return;
    }

    if (this.watcher) {
      gitWarn('GitHotReload', '文件监听器已在运行');
      return;
    }

    gitLog('GitHotReload', `开始监听仓库: ${this.repoPath}`);

    try {
      // 创建文件监听器
      this.watcher = chokidar.watch(this.repoPath, {
        ignored: this.ignorePatterns,
        persistent: true,
        ignoreInitial: true, // 忽略初始扫描
        awaitWriteFinish: {
          stabilityThreshold: 300, // 文件稳定300ms后才触发
          pollInterval: 100
        },
        depth: 99, // 监听所有子目录
      });

      // 监听文件变化事件
      this.watcher
        .on('add', (filePath) => this.handleFileChange('add', filePath))
        .on('change', (filePath) => this.handleFileChange('change', filePath))
        .on('unlink', (filePath) => this.handleFileChange('unlink', filePath))
        .on('error', (error) => {
          gitError('GitHotReload', '文件监听错误:', error);
          this.emit('error', error);
        })
        .on('ready', () => {
          gitLog('GitHotReload', '文件监听器就绪');
          this.emit('ready');
        });

      // 监听Git管理器事件
      this.setupGitManagerListeners();

      gitLog('GitHotReload', '✓ Git热重载已启动');
      this.emit('started');
    } catch (error) {
      gitError('GitHotReload', '启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止文件监听
   */
  async stop() {
    if (!this.watcher) {
      return;
    }

    gitLog('GitHotReload', '停止Git热重载...');

    try {
      // 清除防抖定时器
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }

      // 关闭文件监听器
      await this.watcher.close();
      this.watcher = null;

      gitLog('GitHotReload', '✓ Git热重载已停止');
      this.emit('stopped');
    } catch (error) {
      gitError('GitHotReload', '停止失败:', error);
      throw error;
    }
  }

  /**
   * 处理文件变化
   * @param {string} eventType - 事件类型 (add/change/unlink)
   * @param {string} filePath - 文件路径
   */
  handleFileChange(eventType, filePath) {
    const relativePath = path.relative(this.repoPath, filePath);

    gitLog('GitHotReload', `文件${eventType}: ${relativePath}`);

    // 发出文件变化事件
    this.emit('file-changed', {
      type: eventType,
      path: relativePath,
      fullPath: filePath,
      timestamp: Date.now()
    });

    // 防抖处理：延迟检查Git状态
    this.scheduleStatusCheck();
  }

  /**
   * 调度状态检查（防抖）
   */
  scheduleStatusCheck() {
    // 清除之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 设置新的定时器
    this.debounceTimer = setTimeout(async () => {
      await this.checkGitStatus();
      this.debounceTimer = null;
    }, this.debounceDelay);
  }

  /**
   * 检查Git状态并通知变化
   */
  async checkGitStatus() {
    try {
      gitLog('GitHotReload', '检查Git状态...');

      // 获取当前状态
      const currentStatus = await this.gitManager.getStatus();

      // 比较状态变化
      const hasChanged = this.hasStatusChanged(this.lastStatus, currentStatus);

      if (hasChanged) {
        gitLog('GitHotReload', 'Git状态已变化');

        // 发出状态变化事件
        this.emit('status-changed', {
          previous: this.lastStatus,
          current: currentStatus,
          timestamp: Date.now()
        });

        // 更新缓存
        this.lastStatus = currentStatus;
      } else {
        gitLog('GitHotReload', 'Git状态无变化');
      }
    } catch (error) {
      gitError('GitHotReload', '检查Git状态失败:', error);
      this.emit('error', error);
    }
  }

  /**
   * 比较两个状态是否有变化
   * @param {Object} oldStatus - 旧状态
   * @param {Object} newStatus - 新状态
   * @returns {boolean}
   */
  hasStatusChanged(oldStatus, newStatus) {
    if (!oldStatus) {
      return true; // 首次检查
    }

    // 比较分支
    if (oldStatus.branch !== newStatus.branch) {
      return true;
    }

    // 比较ahead/behind
    if (oldStatus.ahead !== newStatus.ahead || oldStatus.behind !== newStatus.behind) {
      return true;
    }

    // 比较文件列表
    const oldFiles = [
      ...(oldStatus.modified || []),
      ...(oldStatus.untracked || []),
      ...(oldStatus.deleted || [])
    ].sort();

    const newFiles = [
      ...(newStatus.modified || []),
      ...(newStatus.untracked || []),
      ...(newStatus.deleted || [])
    ].sort();

    // 比较文件数量
    if (oldFiles.length !== newFiles.length) {
      return true;
    }

    // 比较文件内容
    for (let i = 0; i < oldFiles.length; i++) {
      if (oldFiles[i] !== newFiles[i]) {
        return true;
      }
    }

    return false;
  }

  /**
   * 设置Git管理器事件监听
   */
  setupGitManagerListeners() {
    // 监听Git操作事件
    this.gitManager.on('committed', () => {
      gitLog('GitHotReload', '检测到提交事件');
      this.scheduleStatusCheck();
    });

    this.gitManager.on('pushed', () => {
      gitLog('GitHotReload', '检测到推送事件');
      this.scheduleStatusCheck();
    });

    this.gitManager.on('pulled', () => {
      gitLog('GitHotReload', '检测到拉取事件');
      this.scheduleStatusCheck();
    });

    this.gitManager.on('files-added', () => {
      gitLog('GitHotReload', '检测到文件添加事件');
      this.scheduleStatusCheck();
    });

    this.gitManager.on('conflict-resolved', () => {
      gitLog('GitHotReload', '检测到冲突解决事件');
      this.scheduleStatusCheck();
    });

    this.gitManager.on('merge-completed', () => {
      gitLog('GitHotReload', '检测到合并完成事件');
      this.scheduleStatusCheck();
    });
  }

  /**
   * 手动触发状态检查
   */
  async refresh() {
    gitLog('GitHotReload', '手动刷新Git状态');
    await this.checkGitStatus();
  }

  /**
   * 启用/禁用热重载
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    gitLog('GitHotReload', `${enabled ? '启用' : '禁用'}Git热重载`);

    if (enabled && !this.watcher) {
      this.start();
    } else if (!enabled && this.watcher) {
      this.stop();
    }
  }

  /**
   * 设置防抖延迟
   * @param {number} delay - 延迟时间（毫秒）
   */
  setDebounceDelay(delay) {
    this.debounceDelay = delay;
    gitLog('GitHotReload', `设置防抖延迟: ${delay}ms`);
  }

  /**
   * 获取监听状态
   * @returns {Object}
   */
  getStatus() {
    return {
      enabled: this.enabled,
      watching: !!this.watcher,
      repoPath: this.repoPath,
      debounceDelay: this.debounceDelay,
      lastStatus: this.lastStatus
    };
  }
}

module.exports = GitHotReload;
