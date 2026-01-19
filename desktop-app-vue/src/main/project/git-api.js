const { logger, createLogger } = require('../utils/logger.js');

/**
 * Git API 封装
 * 提供项目 Git 操作的后端API调用
 *
 * @module git-api
 * @description Git API 封装，用于调用后端 project-service 的 Git 接口
 *              如果后端不可用，会自动降级到本地 isomorphic-git
 */

/**
 * Git API 类
 * 封装对后端 project-service Git 接口的调用
 */
class GitAPI {
  constructor() {
    // 后端服务地址
    this.baseURL = process.env.PROJECT_SERVICE_URL || 'http://localhost:9090';
    this.timeout = 30000; // 30 秒超时
  }

  /**
   * 调用后端API
   * @param {string} endpoint - API 端点
   * @param {Object} data - 请求数据
   * @returns {Promise<Object>} API 响应
   * @private
   */
  async _call(endpoint, data = {}) {
    try {
      // TODO: 实现实际的 HTTP 请求调用后端服务
      // 目前返回失败状态，让调用方降级到本地 Git
      return {
        success: false,
        status: 0,
        message: '后端服务未配置，使用本地 Git',
        data: null
      };
    } catch (error) {
      logger.error(`[GitAPI] Error calling ${endpoint}:`, error);
      return {
        success: false,
        status: 0,
        message: error.message,
        data: null
      };
    }
  }

  /**
   * 初始化 Git 仓库
   * @param {string} repoPath - 仓库路径
   * @param {string} remoteUrl - 远程仓库URL（可选）
   * @returns {Promise<Object>} 操作结果
   */
  async init(repoPath, remoteUrl = null) {
    return this._call('/api/git/init', { repoPath, remoteUrl });
  }

  /**
   * 获取 Git 状态
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 状态信息
   */
  async status(repoPath) {
    return this._call('/api/git/status', { repoPath });
  }

  /**
   * 提交更改
   * @param {string} repoPath - 仓库路径
   * @param {string} message - 提交消息
   * @param {Object} author - 作者信息
   * @param {boolean} autoGenerate - 是否自动生成提交消息
   * @returns {Promise<Object>} 提交结果
   */
  async commit(repoPath, message, author, autoGenerate = false) {
    return this._call('/api/git/commit', { repoPath, message, author, autoGenerate });
  }

  /**
   * 推送到远程仓库
   * @param {string} repoPath - 仓库路径
   * @param {string} remote - 远程仓库名称
   * @param {string} branch - 分支名称
   * @returns {Promise<Object>} 推送结果
   */
  async push(repoPath, remote = 'origin', branch = 'main') {
    return this._call('/api/git/push', { repoPath, remote, branch });
  }

  /**
   * 从远程仓库拉取
   * @param {string} repoPath - 仓库路径
   * @param {string} remote - 远程仓库名称
   * @param {string} branch - 分支名称
   * @returns {Promise<Object>} 拉取结果
   */
  async pull(repoPath, remote = 'origin', branch = 'main') {
    return this._call('/api/git/pull', { repoPath, remote, branch });
  }

  /**
   * 获取提交日志
   * @param {string} repoPath - 仓库路径
   * @param {number} limit - 日志条数限制
   * @returns {Promise<Object>} 提交日志
   */
  async log(repoPath, limit = 10) {
    return this._call('/api/git/log', { repoPath, limit });
  }

  /**
   * 获取文件差异
   * @param {string} repoPath - 仓库路径
   * @param {string} ref1 - 第一个引用
   * @param {string} ref2 - 第二个引用
   * @returns {Promise<Object>} 差异信息
   */
  async diff(repoPath, ref1, ref2) {
    return this._call('/api/git/diff', { repoPath, ref1, ref2 });
  }

  /**
   * 获取分支列表
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 分支列表
   */
  async branches(repoPath) {
    return this._call('/api/git/branches', { repoPath });
  }

  /**
   * 创建分支
   * @param {string} repoPath - 仓库路径
   * @param {string} branchName - 新分支名称
   * @param {string} fromBranch - 基于的分支
   * @returns {Promise<Object>} 创建结果
   */
  async createBranch(repoPath, branchName, fromBranch = null) {
    return this._call('/api/git/create-branch', { repoPath, branchName, fromBranch });
  }

  /**
   * 切换分支
   * @param {string} repoPath - 仓库路径
   * @param {string} branchName - 目标分支名称
   * @returns {Promise<Object>} 切换结果
   */
  async checkoutBranch(repoPath, branchName) {
    return this._call('/api/git/checkout', { repoPath, branchName });
  }

  /**
   * 合并分支
   * @param {string} repoPath - 仓库路径
   * @param {string} sourceBranch - 源分支
   * @param {string} targetBranch - 目标分支
   * @returns {Promise<Object>} 合并结果
   */
  async merge(repoPath, sourceBranch, targetBranch) {
    return this._call('/api/git/merge', { repoPath, sourceBranch, targetBranch });
  }

  /**
   * 解决冲突
   * @param {string} repoPath - 仓库路径
   * @param {string} filePath - 文件路径
   * @param {boolean} useOurs - 是否使用本地版本
   * @param {string} strategy - 解决策略
   * @returns {Promise<Object>} 解决结果
   */
  async resolveConflicts(repoPath, filePath, useOurs, strategy) {
    return this._call('/api/git/resolve-conflicts', { repoPath, filePath, useOurs, strategy });
  }

  /**
   * 生成提交消息
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 生成的提交消息
   */
  async generateCommitMessage(repoPath) {
    return this._call('/api/git/generate-commit-message', { repoPath });
  }
}

// 导出单例
module.exports = new GitAPI();
