/**
 * P2P 项目服务
 *
 * 通过P2P网络访问PC端项目数据
 */

import p2pManager from './p2p-manager.js'
import fileCache from '@/utils/file-cache.js'

class ProjectService {
  constructor() {
    // 请求超时时间（30秒）
    this.timeout = 30000

    // 等待响应的请求
    this.pendingRequests = new Map()

    // 监听P2P消息响应
    p2pManager.on('message', this.handleMessage.bind(this))
  }

  /**
   * 处理P2P消息
   */
  handleMessage(data) {
    const { message } = data

    // 检查是否是项目服务的响应
    if (message.type && message.type.startsWith('project:') && message.type.endsWith(':response')) {
      const requestId = message.requestId

      if (requestId && this.pendingRequests.has(requestId)) {
        const { resolve, reject, timer } = this.pendingRequests.get(requestId)

        // 清除超时定时器
        if (timer) {
          clearTimeout(timer)
        }

        // 删除请求记录
        this.pendingRequests.delete(requestId)

        // 返回数据
        if (message.data) {
          resolve(message.data)
        } else if (message.error) {
          reject(new Error(message.error))
        } else {
          reject(new Error('未知错误'))
        }
      }
    } else if (message.type === 'error' && message.requestId) {
      // 处理错误响应
      const requestId = message.requestId

      if (this.pendingRequests.has(requestId)) {
        const { reject, timer } = this.pendingRequests.get(requestId)

        if (timer) {
          clearTimeout(timer)
        }

        this.pendingRequests.delete(requestId)
        reject(new Error(message.error || '请求失败'))
      }
    }
  }

  /**
   * 发送P2P请求并等待响应
   */
  async sendRequest(peerId, type, params = {}) {
    return new Promise((resolve, reject) => {
      // 检查连接状态
      const state = p2pManager.getConnectionState(peerId)
      if (state !== 'connected') {
        reject(new Error('设备未连接'))
        return
      }

      // 生成请求ID
      const requestId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      // 设置超时
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error('请求超时'))
        }
      }, this.timeout)

      // 保存请求回调
      this.pendingRequests.set(requestId, { resolve, reject, timer })

      // 发送消息
      const success = p2pManager.sendMessage(peerId, {
        type,
        requestId,
        params
      })

      if (!success) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        reject(new Error('发送消息失败'))
      }
    })
  }

  /**
   * 获取项目列表
   */
  async getProjects(peerId, limit = 50, offset = 0) {
    try {
      const data = await this.sendRequest(peerId, 'project:list-projects', {
        limit,
        offset
      })

      return data
    } catch (error) {
      console.error('[ProjectService] 获取项目列表失败:', error)
      throw error
    }
  }

  /**
   * 获取项目详情
   */
  async getProject(peerId, projectId) {
    try {
      const data = await this.sendRequest(peerId, 'project:get-project', {
        projectId
      })

      return data.project
    } catch (error) {
      console.error('[ProjectService] 获取项目详情失败:', error)
      throw error
    }
  }

  /**
   * 获取文件树
   */
  async getFileTree(peerId, projectId, maxDepth = 3) {
    try {
      const data = await this.sendRequest(peerId, 'project:get-file-tree', {
        projectId,
        maxDepth
      })

      return data.fileTree
    } catch (error) {
      console.error('[ProjectService] 获取文件树失败:', error)
      throw error
    }
  }

  /**
   * 获取文件内容（带缓存）
   */
  async getFile(peerId, projectId, filePath, useCache = true) {
    try {
      // 先尝试从缓存获取
      if (useCache) {
        const cached = fileCache.get(peerId, projectId, filePath)
        if (cached) {
          console.log('[ProjectService] 从缓存加载文件:', filePath)
          return cached
        }
      }

      // 缓存未命中，从服务器获取
      const data = await this.sendRequest(peerId, 'project:get-file', {
        projectId,
        filePath
      })

      // 保存到缓存
      if (useCache && data) {
        fileCache.set(peerId, projectId, filePath, data)
      }

      return data
    } catch (error) {
      console.error('[ProjectService] 获取文件内容失败:', error)
      throw error
    }
  }

  /**
   * 清空文件缓存
   */
  clearCache() {
    fileCache.clear()
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return fileCache.getStats()
  }

  /**
   * 搜索文件
   */
  async searchFiles(peerId, projectId, query, fileTypes = []) {
    try {
      const data = await this.sendRequest(peerId, 'project:search-files', {
        projectId,
        query,
        fileTypes
      })

      return data
    } catch (error) {
      console.error('[ProjectService] 搜索文件失败:', error)
      throw error
    }
  }
}

// 导出单例
export default new ProjectService()
