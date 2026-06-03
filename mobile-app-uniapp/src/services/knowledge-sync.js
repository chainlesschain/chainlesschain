/**
 * 知识库同步服务（移动端）
 *
 * 功能：
 * - 从PC端获取笔记列表
 * - 获取笔记详情
 * - 搜索笔记
 * - 管理本地缓存
 */

import { getP2PManager } from './p2p/p2p-manager'

class KnowledgeSyncService {
  constructor() {
    this.p2pManager = null
    this.pcPeerId = null // 已连接的PC节点ID

    // 请求ID计数器
    this.requestId = 0

    // 待处理请求Map
    this.pendingRequests = new Map() // requestId -> { resolve, reject, timeout }

    // 缓存
    this.cache = {
      folders: null,
      tags: null,
      notes: new Map() // noteId -> note
    }
  }

  /**
   * 初始化
   */
  async initialize(pcPeerId) {
    this.p2pManager = getP2PManager()
    this.pcPeerId = pcPeerId

    // 监听来自PC的响应
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

      // 超时处理
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('请求超时'))
      }, timeoutMs)

      // 保存待处理请求
      this.pendingRequests.set(requestId, { resolve, reject, timeout })

      // 发送请求
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
   * 获取笔记列表
   */
  async listNotes(options = {}) {
    const { folderId, limit = 50, offset = 0, sortBy = 'updated_at', sortOrder = 'DESC' } = options

    const data = await this.sendRequest('knowledge:list-notes', {
      folderId,
      limit,
      offset,
      sortBy,
      sortOrder
    })

    // 更新缓存
    data.notes.forEach(note => {
      this.cache.notes.set(note.id, note)
    })

    return data
  }

  /**
   * 获取笔记详情
   */
  async getNote(noteId, useCache = true) {
    // 检查缓存
    if (useCache && this.cache.notes.has(noteId)) {
      const cachedNote = this.cache.notes.get(noteId)
      // 如果缓存中有完整内容，直接返回
      if (cachedNote.content) {
        return cachedNote
      }
    }

    const data = await this.sendRequest('knowledge:get-note', { noteId })

    // 更新缓存
    this.cache.notes.set(noteId, data.note)

    return data.note
  }

  /**
   * 搜索笔记
   */
  async searchNotes(query, options = {}) {
    const { limit = 20, offset = 0 } = options

    const data = await this.sendRequest('knowledge:search', {
      query,
      limit,
      offset
    })

    return data
  }

  /**
   * 获取文件夹列表
   */
  async getFolders(useCache = true) {
    if (useCache && this.cache.folders) {
      return this.cache.folders
    }

    const data = await this.sendRequest('knowledge:get-folders')

    // 更新缓存
    this.cache.folders = data.folders

    return data.folders
  }

  /**
   * 获取标签列表
   */
  async getTags(useCache = true) {
    if (useCache && this.cache.tags) {
      return this.cache.tags
    }

    const data = await this.sendRequest('knowledge:get-tags')

    // 更新缓存
    this.cache.tags = data.tags

    return data.tags
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.folders = null
    this.cache.tags = null
    this.cache.notes.clear()
  }

  /**
   * 获取缓存的笔记
   */
  getCachedNote(noteId) {
    return this.cache.notes.get(noteId) || null
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      notesCount: this.cache.notes.size,
      hasFolders: !!this.cache.folders,
      hasTags: !!this.cache.tags
    }
  }
}

// 导出单例
let knowledgeSyncInstance = null

export function getKnowledgeSyncService() {
  if (!knowledgeSyncInstance) {
    knowledgeSyncInstance = new KnowledgeSyncService()
  }
  return knowledgeSyncInstance
}

export default KnowledgeSyncService
