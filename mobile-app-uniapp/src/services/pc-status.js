/**
 * PC状态监控服务（移动端）
 *
 * 功能：
 * - 获取PC端系统信息
 * - 监控服务状态
 * - 实时性能监控
 * - 订阅状态更新
 */

import { getP2PManager } from './p2p/p2p-manager'

class PCStatusService {
  constructor() {
    this.p2pManager = null
    this.pcPeerId = null

    this.requestId = 0
    this.pendingRequests = new Map()

    // 状态缓存
    this.cache = {
      systemInfo: null,
      services: null,
      realtimeStatus: null,
      lastUpdate: null
    }

    // 订阅状态
    this.isSubscribed = false
    this.subscriptionInterval = null

    // 状态监听器
    this.statusListeners = []
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

    // 处理订阅的状态更新
    if (message.type === 'pc-status:update' && this.isSubscribed) {
      this.cache.realtimeStatus = message.data
      this.cache.lastUpdate = Date.now()

      // 通知监听器
      this.notifyListeners(message.data)
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
   * 获取系统信息
   */
  async getSystemInfo(useCache = true) {
    if (useCache && this.cache.systemInfo) {
      return this.cache.systemInfo
    }

    const data = await this.sendRequest('pc-status:get-system-info')

    this.cache.systemInfo = data.systemInfo

    return data.systemInfo
  }

  /**
   * 获取服务状态
   */
  async getServices(useCache = false) {
    if (useCache && this.cache.services) {
      return this.cache.services
    }

    const data = await this.sendRequest('pc-status:get-services')

    this.cache.services = data.services

    return data.services
  }

  /**
   * 获取实时状态
   */
  async getRealtimeStatus() {
    const data = await this.sendRequest('pc-status:get-realtime')

    this.cache.realtimeStatus = data
    this.cache.lastUpdate = Date.now()

    return data
  }

  /**
   * 订阅状态更新
   */
  async subscribe(interval = 30000) {
    const data = await this.sendRequest('pc-status:subscribe', { interval })

    this.isSubscribed = data.subscribed
    this.subscriptionInterval = interval

    return data
  }

  /**
   * 取消订阅
   */
  async unsubscribe() {
    // TODO: 实现取消订阅逻辑
    this.isSubscribed = false
    this.subscriptionInterval = null
  }

  /**
   * 添加状态监听器
   */
  onStatusUpdate(callback) {
    this.statusListeners.push(callback)

    // 返回取消监听的函数
    return () => {
      const index = this.statusListeners.indexOf(callback)
      if (index > -1) {
        this.statusListeners.splice(index, 1)
      }
    }
  }

  /**
   * 通知所有监听器
   */
  notifyListeners(status) {
    this.statusListeners.forEach(callback => {
      try {
        callback(status)
      } catch (error) {
        console.error('[PCStatus] 监听器回调错误:', error)
      }
    })
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.systemInfo = null
    this.cache.services = null
    this.cache.realtimeStatus = null
    this.cache.lastUpdate = null
  }

  /**
   * 获取缓存状态
   */
  getCachedStatus() {
    return {
      ...this.cache,
      isSubscribed: this.isSubscribed
    }
  }

  /**
   * 格式化字节大小
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  /**
   * 格式化运行时间
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    const parts = []
    if (days > 0) parts.push(`${days}天`)
    if (hours > 0) parts.push(`${hours}小时`)
    if (minutes > 0) parts.push(`${minutes}分钟`)

    return parts.join(' ') || '刚刚启动'
  }
}

// 导出单例
let pcStatusInstance = null

export function getPCStatusService() {
  if (!pcStatusInstance) {
    pcStatusInstance = new PCStatusService()
  }
  return pcStatusInstance
}

export default PCStatusService
