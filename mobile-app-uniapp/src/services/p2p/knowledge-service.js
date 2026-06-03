/**
 * P2P知识库服务
 *
 * 功能：
 * - 通过P2P从PC端获取知识库数据
 * - 获取笔记列表
 * - 搜索笔记
 * - 获取笔记详情
 * - 获取文件夹列表
 * - 获取标签列表
 */

import { getP2PManager } from './p2p-manager'

class P2PKnowledgeService {
  constructor() {
    this.p2pManager = null
    this.pendingRequests = new Map() // requestId -> { resolve, reject, type }
    this.messageHandler = null
  }

  /**
   * 初始化
   */
  async initialize() {
    this.p2pManager = getP2PManager()

    if (!this.p2pManager.isInitialized) {
      throw new Error('P2P管理器未初始化')
    }

    // 监听消息
    this.messageHandler = this.handleMessage.bind(this)
    this.p2pManager.on('message', this.messageHandler)

    console.log('[P2PKnowledgeService] 初始化成功')
  }

  /**
   * 处理P2P消息
   */
  handleMessage({ peerId, message }) {
    const { requestId, type, data, error } = message

    // 查找对应的请求
    const request = this.pendingRequests.get(requestId)
    if (!request) return

    this.pendingRequests.delete(requestId)

    if (error) {
      request.reject(new Error(error))
      return
    }

    // 解析响应
    request.resolve(data)
  }

  /**
   * 发送P2P请求
   */
  async sendRequest(pcPeerId, type, params = {}) {
    return new Promise((resolve, reject) => {
      // 检查连接状态
      if (!this.p2pManager || this.p2pManager.getConnectionState(pcPeerId) !== 'connected') {
        reject(new Error('PC设备未连接'))
        return
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // 保存请求回调
      this.pendingRequests.set(requestId, { resolve, reject, type })

      // 发送消息
      this.p2pManager.sendMessage(pcPeerId, {
        type,
        requestId,
        params,
        timestamp: Date.now()
      })

      // 30秒超时
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error('请求超时'))
        }
      }, 30000)
    })
  }

  /**
   * 获取笔记列表
   * @param {string} pcPeerId - PC端节点ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} { notes, total, limit, offset }
   */
  async listNotes(pcPeerId, options = {}) {
    const {
      folderId = null,
      limit = 20,
      offset = 0,
      sortBy = 'updated_at',
      sortOrder = 'DESC'
    } = options

    const data = await this.sendRequest(pcPeerId, 'knowledge:list-notes', {
      folderId,
      limit,
      offset,
      sortBy,
      sortOrder
    })

    return data
  }

  /**
   * 搜索笔记
   * @param {string} pcPeerId - PC端节点ID
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Object>} { notes, total, limit, offset, query }
   */
  async searchNotes(pcPeerId, query, options = {}) {
    const { limit = 20, offset = 0 } = options

    const data = await this.sendRequest(pcPeerId, 'knowledge:search', {
      query,
      limit,
      offset
    })

    return data
  }

  /**
   * 获取笔记详情
   * @param {string} pcPeerId - PC端节点ID
   * @param {string} noteId - 笔记ID
   * @returns {Promise<Object>} { note }
   */
  async getNote(pcPeerId, noteId) {
    const data = await this.sendRequest(pcPeerId, 'knowledge:get-note', {
      noteId
    })

    return data
  }

  /**
   * 获取文件夹列表
   * @param {string} pcPeerId - PC端节点ID
   * @returns {Promise<Object>} { folders }
   */
  async getFolders(pcPeerId) {
    const data = await this.sendRequest(pcPeerId, 'knowledge:get-folders', {})
    return data
  }

  /**
   * 获取标签列表
   * @param {string} pcPeerId - PC端节点ID
   * @returns {Promise<Object>} { tags }
   */
  async getTags(pcPeerId) {
    const data = await this.sendRequest(pcPeerId, 'knowledge:get-tags', {})
    return data
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.p2pManager && this.messageHandler) {
      this.p2pManager.off('message', this.messageHandler)
    }

    this.pendingRequests.clear()
  }
}

// 导出单例
let knowledgeServiceInstance = null

export function getP2PKnowledgeService() {
  if (!knowledgeServiceInstance) {
    knowledgeServiceInstance = new P2PKnowledgeService()
  }
  return knowledgeServiceInstance
}

export default P2PKnowledgeService
