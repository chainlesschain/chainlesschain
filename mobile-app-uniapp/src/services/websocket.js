/**
 * 实时 WebSocket 服务
 *
 * 功能：
 * - 自动重连
 * - 心跳检测
 * - 事件分发与订阅
 * - 消息队列（连接恢复后自动发送）
 *
 * 用法：
 * ```
 * import realtimeService from '@/services/websocket'
 * await realtimeService.ensureConnection({ did })
 * realtimeService.on('message:incoming', handler)
 * await realtimeService.send('message:send', payload)
 * ```
 */

const runtimeEnv = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {}
const processEnv = (typeof process !== 'undefined' && process.env) ? process.env : {}

const DEFAULT_WS_URL =
  runtimeEnv.VITE_REALTIME_WS_URL ||
  runtimeEnv.VUE_APP_REALTIME_WS_URL ||
  processEnv.VITE_REALTIME_WS_URL ||
  processEnv.VUE_APP_REALTIME_WS_URL ||
  'ws://127.0.0.1:9002/ws'

class WebSocketService {
  constructor() {
    this.config = {
      url: DEFAULT_WS_URL,
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectInterval: 30000,
      heartbeatInterval: 30000,
      debug: false
    }

    this.socketTask = null
    this.isConnected = false
    this.isConnecting = false
    this.shouldReconnect = true
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.heartbeatTimer = null

    this.currentDid = null
    this.authToken = null

    this.eventHandlers = new Map()
    this.pendingQueue = []

    this.isSupported = typeof uni !== 'undefined' && typeof uni.connectSocket === 'function'
  }

  /**
   * 确保已建立连接
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async ensureConnection(options = {}) {
    if (options.url) {
      this.config.url = options.url
    }
    if (typeof options.autoReconnect === 'boolean') {
      this.config.autoReconnect = options.autoReconnect
    }
    if (options.heartbeatInterval) {
      this.config.heartbeatInterval = options.heartbeatInterval
    }
    if (options.did) {
      this.currentDid = options.did
    }
    if (options.token) {
      this.authToken = options.token
    }

    if (!this.isSupported) {
      console.warn('[RealtimeService] 当前环境不支持 WebSocket，已启用降级模式')
      return { supported: false }
    }

    if (this.isConnected || this.isConnecting) {
      return { connected: this.isConnected }
    }

    return await this.connect()
  }

  /**
   * 建立 WebSocket 连接
   */
  async connect() {
    if (!this.isSupported) {
      return { supported: false }
    }

    if (this.isConnecting || this.isConnected) {
      return { connected: this.isConnected }
    }

    this.isConnecting = true
    this.shouldReconnect = true

    return new Promise((resolve, reject) => {
      try {
        const socketTask = uni.connectSocket({
          url: this.config.url,
          success: () => {
            if (this.config.debug) {
              console.log('[RealtimeService] 开始连接 WebSocket...')
            }
          },
          fail: (error) => {
            this.isConnecting = false
            console.error('[RealtimeService] 创建 WebSocket 失败:', error)
            this.scheduleReconnect()
            reject(error)
          }
        })

        this.socketTask = socketTask

        socketTask.onOpen(() => {
          this.isConnecting = false
          this.isConnected = true
          this.reconnectAttempts = 0
          this.emitLocal('connected')
          this.sendAuthHandshake()
          this.flushQueue()
          this.startHeartbeat()
          resolve({ connected: true })
        })

        socketTask.onMessage((event) => {
          this.handleIncomingMessage(event?.data)
        })

        socketTask.onError((error) => {
          console.error('[RealtimeService] WebSocket 错误:', error)
          this.emitLocal('error', error)
        })

        socketTask.onClose(() => {
          this.isConnecting = false
          if (this.isConnected) {
            this.emitLocal('disconnected')
          }
          this.isConnected = false
          this.stopHeartbeat()
          if (this.shouldReconnect) {
            this.scheduleReconnect()
          }
        })
      } catch (error) {
        this.isConnecting = false
        console.error('[RealtimeService] 连接 WebSocket 失败:', error)
        this.scheduleReconnect()
        reject(error)
      }
    })
  }

  /**
   * 发送身份认证信息
   * @private
   */
  sendAuthHandshake() {
    if (!this.currentDid || !this.socketTask || !this.isConnected) {
      return
    }

    const payload = {
      type: 'auth',
      payload: {
        did: this.currentDid,
        token: this.authToken || null
      },
      timestamp: Date.now()
    }

    this.sendRaw(payload, true)
  }

  /**
   * 更新身份信息
   * @param {string} did
   * @param {string} token
   */
  updateIdentity(did, token) {
    this.currentDid = did
    if (token) {
      this.authToken = token
    }
    if (this.isConnected) {
      this.sendAuthHandshake()
    }
  }

  /**
   * 发送消息
   * @param {string} event 事件类型
   * @param {Object} payload 数据
   * @returns {Promise<Object>}
   */
  async send(event, payload = {}) {
    const message = {
      id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: event,
      payload,
      did: this.currentDid,
      timestamp: Date.now()
    }

    if (!this.isSupported) {
      return { ok: false, skipped: true }
    }

    if (!this.isConnected || !this.socketTask) {
      if (this.config.debug) {
        console.log('[RealtimeService] 连接未就绪，消息加入发送队列:', event)
      }
      this.pendingQueue.push(message)
      this.ensureConnection()
      return { ok: false, queued: true }
    }

    try {
      await this.sendRaw(message)
      return { ok: true }
    } catch (error) {
      console.error('[RealtimeService] 发送消息失败:', error)
      this.pendingQueue.push(message)
      return { ok: false, error }
    }
  }

  /**
   * 直接发送原始消息
   * @private
   */
  sendRaw(message, internal = false) {
    return new Promise((resolve, reject) => {
      if (!this.socketTask || !this.isConnected) {
        if (!internal) {
          this.pendingQueue.push(message)
        }
        resolve({ ok: false, queued: true })
        return
      }

      try {
        this.socketTask.send({
          data: JSON.stringify(message),
          success: () => resolve({ ok: true }),
          fail: (error) => {
            if (!internal) {
              this.pendingQueue.push(message)
            }
            reject(error)
          }
        })
      } catch (error) {
        if (!internal) {
          this.pendingQueue.push(message)
        }
        reject(error)
      }
    })
  }

  /**
   * 处理服务器推送消息
   * @private
   */
  handleIncomingMessage(raw) {
    if (!raw) {
      return
    }

    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!data || !data.type) {
        return
      }

      if (data.type === 'pong') {
        return
      }

      if (data.type === 'ack' && data.payload?.event) {
        this.emitLocal(`ack:${data.payload.event}`, data.payload)
        return
      }

      this.emitLocal(data.type, data.payload || data.data || data)
    } catch (error) {
      console.error('[RealtimeService] 解析消息失败:', error)
    }
  }

  /**
   * 将队列中的消息重新发送
   * @private
   */
  flushQueue() {
    if (!this.pendingQueue.length || !this.isConnected) {
      return
    }

    const queue = [...this.pendingQueue]
    this.pendingQueue = []

    queue.forEach(message => {
      this.sendRaw(message).catch(() => {
        this.pendingQueue.push(message)
      })
    })
  }

  /**
   * 启动心跳
   * @private
   */
  startHeartbeat() {
    this.stopHeartbeat()
    if (!this.config.heartbeatInterval) {
      return
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.sendRaw({
          type: 'ping',
          timestamp: Date.now()
        }, true)
      }
    }, this.config.heartbeatInterval)
  }

  /**
   * 停止心跳
   * @private
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * 安排重连
   * @private
   */
  scheduleReconnect() {
    if (!this.config.autoReconnect) {
      return
    }
    if (this.reconnectTimer) {
      return
    }

    const delay = Math.min(
      this.config.reconnectInterval * Math.max(1, this.reconnectAttempts + 1),
      this.config.maxReconnectInterval
    )

    this.reconnectAttempts += 1

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(() => {
        this.scheduleReconnect()
      })
    }, delay)
  }

  /**
   * 订阅事件
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event).add(handler)
  }

  /**
   * 取消订阅事件
   */
  off(event, handler) {
    const handlers = this.eventHandlers.get(event)
    if (!handlers) {
      return
    }
    handlers.delete(handler)
    if (handlers.size === 0) {
      this.eventHandlers.delete(event)
    }
  }

  /**
   * 触发本地事件
   * @private
   */
  emitLocal(event, data) {
    const handlers = this.eventHandlers.get(event)
    if (!handlers || handlers.size === 0) {
      return
    }
    handlers.forEach(handler => {
      try {
        handler(data)
      } catch (error) {
        console.error(`[RealtimeService] 事件处理失败 (${event}):`, error)
      }
    })
  }

  /**
   * 主动断开连接
   * @param {Object} options
   */
  disconnect(options = {}) {
    const { reconnect = false } = options
    this.shouldReconnect = reconnect
    this.stopHeartbeat()

    if (this.socketTask) {
      try {
        this.socketTask.close && this.socketTask.close()
      } catch (error) {
        console.warn('[RealtimeService] 关闭 WebSocket 失败:', error)
      }
    }

    this.socketTask = null
    this.isConnected = false
  }

  /**
   * 连接是否就绪
   * @returns {boolean}
   */
  isReady() {
    return this.isConnected
  }
}

const realtimeService = new WebSocketService()

export default realtimeService
export { WebSocketService }
