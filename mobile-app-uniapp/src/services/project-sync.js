/**
 * 项目同步服务（移动端）
 *
 * 功能：
 * - 从PC端获取项目列表
 * - 获取项目详情
 * - 获取文件树
 * - 获取文件内容
 * - 搜索文件
 */

import { getP2PManager } from './p2p/p2p-manager'

class ProjectSyncService {
  constructor() {
    this.p2pManager = null
    this.pcPeerId = null

    this.requestId = 0
    this.pendingRequests = new Map()

    // 缓存
    this.cache = {
      projects: null,
      fileTrees: new Map(), // projectId -> fileTree
      files: new Map() // filePath -> fileContent
    }
  }

  /**
   * 初始化
   */
  async initialize(pcPeerId) {
    this.p2pManager = getP2PManager()
    this.pcPeerId = pcPeerId

    this.p2pManager.on('message', ({ message }) => {
      this.handleMessage(message)
    })
  }

  /**
   * 处理来自PC的消息
   */
  handleMessage(message) {
    if (message.requestId && this.pendingRequests.has(message.requestId)) {
      const pending = this.pendingRequests.get(message.requestId)

      clearTimeout(pending.timeout)
      this.pendingRequests.delete(message.requestId)

      if (message.type === 'error') {
        pending.reject(new Error(message.error))
      } else {
        pending.resolve(message.data)
      }
    }
  }

  /**
   * 发送请求到PC端
   */
  async sendRequest(type, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestId}_${Date.now()}`

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('请求超时'))
      }, timeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timeout })

      this.p2pManager.sendMessage(this.pcPeerId, {
        type,
        requestId,
        params
      }).catch(error => {
        clearTimeout(timeout)
        this.pendingRequests.delete(requestId)
        reject(error)
      })
    })
  }

  /**
   * 获取项目列表
   */
  async listProjects(options = {}) {
    const { limit = 50, offset = 0 } = options

    const data = await this.sendRequest('project:list-projects', {
      limit,
      offset
    })

    // 更新缓存
    this.cache.projects = data.projects

    return data
  }

  /**
   * 获取项目详情
   */
  async getProject(projectId) {
    const data = await this.sendRequest('project:get-project', { projectId })

    return data.project
  }

  /**
   * 获取文件树
   */
  async getFileTree(projectId, options = {}) {
    const { maxDepth = 3, useCache = true } = options

    // 检查缓存
    if (useCache && this.cache.fileTrees.has(projectId)) {
      return this.cache.fileTrees.get(projectId)
    }

    const data = await this.sendRequest('project:get-file-tree', {
      projectId,
      maxDepth
    })

    // 更新缓存
    this.cache.fileTrees.set(projectId, data.fileTree)

    return data.fileTree
  }

  /**
   * 获取文件内容
   */
  async getFile(projectId, filePath, useCache = true) {
    const cacheKey = `${projectId}:${filePath}`

    // 检查缓存
    if (useCache && this.cache.files.has(cacheKey)) {
      return this.cache.files.get(cacheKey)
    }

    const data = await this.sendRequest('project:get-file', {
      projectId,
      filePath
    }, 60000) // 文件可能较大，超时时间设为60秒

    // 更新缓存
    this.cache.files.set(cacheKey, data)

    return data
  }

  /**
   * 搜索文件
   */
  async searchFiles(projectId, query, options = {}) {
    const { fileTypes = [] } = options

    const data = await this.sendRequest('project:search-files', {
      projectId,
      query,
      fileTypes
    })

    return data
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.projects = null
    this.cache.fileTrees.clear()
    this.cache.files.clear()
  }

  /**
   * 清除项目缓存
   */
  clearProjectCache(projectId) {
    this.cache.fileTrees.delete(projectId)

    // 清除该项目的所有文件缓存
    const prefix = `${projectId}:`
    for (const key of this.cache.files.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.files.delete(key)
      }
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      projectsCount: this.cache.projects ? this.cache.projects.length : 0,
      fileTreesCount: this.cache.fileTrees.size,
      filesCount: this.cache.files.size
    }
  }
}

// 导出单例
let projectSyncInstance = null

export function getProjectSyncService() {
  if (!projectSyncInstance) {
    projectSyncInstance = new ProjectSyncService()
  }
  return projectSyncInstance
}

export default ProjectSyncService
