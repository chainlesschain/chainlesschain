/**
 * Git自动同步服务 (移动端版本)
 *
 * 功能：
 * - 自动检测文件更改
 * - 定期自动提交
 * - 可选自动推送
 * - 支持多仓库管理
 *
 * 功能对齐桌面端
 */

import GitManager from './git-manager.js'

/**
 * Git自动同步服务类
 */
class GitAutoSyncService {
  constructor(config = {}) {
    this.config = {
      // 同步间隔（毫秒）
      interval: config.interval || 5 * 60 * 1000, // 默认5分钟

      // 是否启用
      enabled: config.enabled !== false, // 默认启用

      // 是否自动推送
      autoPush: config.autoPush !== false, // 默认启用

      // 提交消息前缀
      commitPrefix: config.commitPrefix || 'Auto-commit',

      // 作者信息
      author: config.author || {
        name: 'ChainlessChain',
        email: 'auto-sync@chainlesschain.com'
      },

      ...config
    }

    // 监视的仓库管理器
    this.gitManagers = new Map() // repoName -> GitManager

    // 定时器
    this.timers = new Map() // repoName -> timer

    // 统计信息
    this.stats = {
      totalSyncs: 0,
      lastSyncTime: null,
      errors: 0
    }
  }

  /**
   * 启动自动同步
   * @param {string} repoName - 仓库名称
   * @param {Object} gitConfig - Git配置
   * @returns {Promise<boolean>}
   */
  async start(repoName, gitConfig = {}) {
    if (!this.config.enabled) {
      console.log('[GitAutoSync] 自动同步已禁用')
      return false
    }

    try {
      // 如果已经在监视，先停止
      if (this.gitManagers.has(repoName)) {
        this.stop(repoName)
      }

      console.log('[GitAutoSync] 启动自动同步:', repoName)

      // 创建Git管理器
      const gitManager = new GitManager({
        repoName,
        authorName: this.config.author.name,
        authorEmail: this.config.author.email,
        ...gitConfig
      })

      // 初始化
      await gitManager.initialize()

      // 保存管理器
      this.gitManagers.set(repoName, gitManager)

      // 启动定时器
      const timer = setInterval(async () => {
        await this.syncRepository(repoName)
      }, this.config.interval)

      this.timers.set(repoName, timer)

      console.log('[GitAutoSync] ✅ 自动同步已启动:', repoName)

      // 立即执行一次同步
      await this.syncRepository(repoName)

      return true
    } catch (error) {
      console.error('[GitAutoSync] 启动失败:', error)
      this.stats.errors++
      throw error
    }
  }

  /**
   * 停止自动同步
   * @param {string} repoName - 仓库名称
   */
  stop(repoName) {
    const timer = this.timers.get(repoName)

    if (timer) {
      clearInterval(timer)
      this.timers.delete(repoName)
      console.log('[GitAutoSync] 停止自动同步:', repoName)
    }

    const gitManager = this.gitManagers.get(repoName)

    if (gitManager) {
      gitManager.close()
      this.gitManagers.delete(repoName)
    }
  }

  /**
   * 停止所有自动同步
   */
  stopAll() {
    console.log('[GitAutoSync] 停止所有自动同步')

    for (const repoName of this.gitManagers.keys()) {
      this.stop(repoName)
    }
  }

  /**
   * 同步仓库
   * @param {string} repoName - 仓库名称
   * @returns {Promise<Object>}
   * @private
   */
  async syncRepository(repoName) {
    const gitManager = this.gitManagers.get(repoName)

    if (!gitManager) {
      console.error('[GitAutoSync] 仓库管理器不存在:', repoName)
      return { synced: false, error: '仓库管理器不存在' }
    }

    try {
      console.log('[GitAutoSync] 检查仓库更改:', repoName)

      // 获取状态
      const status = await gitManager.getStatus()

      // 如果没有更改，跳过
      if (status.isClean) {
        console.log('[GitAutoSync] 仓库无更改:', repoName)
        return { synced: false, message: '没有更改' }
      }

      console.log('[GitAutoSync] 发现更改:', {
        modified: status.modified.length,
        untracked: status.untracked.length,
        deleted: status.deleted.length
      })

      // 添加所有更改
      const allFiles = [
        ...status.modified,
        ...status.untracked,
        ...status.deleted
      ]

      for (const file of allFiles) {
        await gitManager.add(file)
      }

      // 生成提交消息
      const message = this.generateCommitMessage(status)

      // 提交
      const sha = await gitManager.commit(message)

      console.log('[GitAutoSync] ✅ 提交成功:', sha)

      // 推送（如果启用）
      if (this.config.autoPush && gitManager.remote.url) {
        try {
          await gitManager.push()
          console.log('[GitAutoSync] ✅ 推送成功')
        } catch (pushError) {
          console.error('[GitAutoSync] 推送失败:', pushError)
          // 推送失败不影响本地提交
        }
      }

      // 更新统计
      this.stats.totalSyncs++
      this.stats.lastSyncTime = new Date()

      return {
        synced: true,
        sha,
        filesCount: allFiles.length,
        message
      }
    } catch (error) {
      console.error('[GitAutoSync] 同步失败:', error)
      this.stats.errors++

      return {
        synced: false,
        error: error.message
      }
    }
  }

  /**
   * 生成提交消息
   * @param {Object} status - Git状态
   * @returns {string}
   * @private
   */
  generateCommitMessage(status) {
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    const changes = []

    if (status.modified.length > 0) {
      changes.push(`${status.modified.length}个文件修改`)
    }

    if (status.untracked.length > 0) {
      changes.push(`${status.untracked.length}个新文件`)
    }

    if (status.deleted.length > 0) {
      changes.push(`${status.deleted.length}个文件删除`)
    }

    const summary = changes.join(', ')

    return `${this.config.commitPrefix}: ${timestamp}\n\n${summary}`
  }

  /**
   * 手动触发同步
   * @param {string} repoName - 仓库名称
   * @returns {Promise<Object>}
   */
  async manualSync(repoName) {
    console.log('[GitAutoSync] 手动同步:', repoName)
    return await this.syncRepository(repoName)
  }

  /**
   * 获取仓库状态
   * @param {string} repoName - 仓库名称
   * @returns {Promise<Object>}
   */
  async getRepoStatus(repoName) {
    const gitManager = this.gitManagers.get(repoName)

    if (!gitManager) {
      throw new Error(`仓库不存在: ${repoName}`)
    }

    return await gitManager.getStatus()
  }

  /**
   * 配置远程仓库
   * @param {string} repoName - 仓库名称
   * @param {string} url - 远程仓库URL
   * @param {Object} auth - 认证信息
   * @returns {Promise<boolean>}
   */
  async setRemote(repoName, url, auth = null) {
    const gitManager = this.gitManagers.get(repoName)

    if (!gitManager) {
      throw new Error(`仓库不存在: ${repoName}`)
    }

    await gitManager.setRemote(url)

    if (auth) {
      gitManager.setAuth(auth)
    }

    console.log('[GitAutoSync] ✅ 远程仓库已配置:', url)

    return true
  }

  /**
   * 设置同步间隔
   * @param {number} interval - 间隔时间（毫秒）
   */
  setInterval(interval) {
    this.config.interval = interval
    console.log('[GitAutoSync] 设置同步间隔:', interval, 'ms')

    // 重启所有定时器
    const repoNames = Array.from(this.gitManagers.keys())

    for (const repoName of repoNames) {
      const gitManager = this.gitManagers.get(repoName)
      const gitConfig = {
        remoteUrl: gitManager.remote.url,
        auth: gitManager.auth
      }

      this.stop(repoName)
      this.start(repoName, gitConfig)
    }
  }

  /**
   * 启用/禁用自动同步
   * @param {boolean} enabled - 是否启用
   */
  setEnabled(enabled) {
    this.config.enabled = enabled
    console.log('[GitAutoSync]', enabled ? '启用' : '禁用', '自动同步')

    if (!enabled) {
      this.stopAll()
    }
  }

  /**
   * 启用/禁用自动推送
   * @param {boolean} autoPush - 是否自动推送
   */
  setAutoPush(autoPush) {
    this.config.autoPush = autoPush
    console.log('[GitAutoSync] 自动推送:', autoPush ? '启用' : '禁用')
  }

  /**
   * 获取监视的仓库列表
   * @returns {Array<string>}
   */
  getWatchedRepositories() {
    return Array.from(this.gitManagers.keys())
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      autoPush: this.config.autoPush,
      interval: this.config.interval,
      watchedRepos: this.gitManagers.size,
      totalSyncs: this.stats.totalSyncs,
      lastSyncTime: this.stats.lastSyncTime,
      errors: this.stats.errors
    }
  }

  /**
   * 获取Git管理器实例
   * @param {string} repoName - 仓库名称
   * @returns {GitManager|null}
   */
  getGitManager(repoName) {
    return this.gitManagers.get(repoName) || null
  }

  /**
   * 检查仓库是否正在同步
   * @param {string} repoName - 仓库名称
   * @returns {boolean}
   */
  isWatching(repoName) {
    return this.gitManagers.has(repoName)
  }
}

// 创建单例
let autoSyncInstance = null

/**
 * 获取Git自动同步服务实例
 * @param {Object} config - 配置
 * @returns {GitAutoSyncService}
 */
export function getGitAutoSync(config) {
  if (!autoSyncInstance) {
    autoSyncInstance = new GitAutoSyncService(config)
  }
  return autoSyncInstance
}

export default GitAutoSyncService
