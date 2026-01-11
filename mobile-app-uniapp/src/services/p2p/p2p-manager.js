/**
 * P2P网络管理器 (移动端版本)
 *
 * 使用WebRTC进行端到端通信，WebSocket作为信令服务器
 * 兼容H5、小程序、App三端
 *
 * 架构对齐桌面端，但使用移动端兼容的技术栈：
 * - WebRTC代替libp2p的传输层
 * - WebSocket信令服务器代替DHT网络发现
 * - STUN/TURN服务器实现NAT穿透
 */

class P2PManager {
  constructor(config = {}) {
    this.config = {
      // 信令服务器配置
      signalingServer: config.signalingServer || 'wss://chainlesschain.io/signal',

      // STUN服务器配置（用于NAT穿透）
      iceServers: config.iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],

      // TURN服务器配置（用于中继）
      turnServers: config.turnServers || [],

      // P2P配置
      enableAutoReconnect: config.enableAutoReconnect !== false,
      reconnectInterval: config.reconnectInterval || 5000,
      heartbeatInterval: config.heartbeatInterval || 30000,
      connectionTimeout: config.connectionTimeout || 30000,

      // 消息配置
      messageQueueSize: config.messageQueueSize || 100,
      enableOfflineQueue: config.enableOfflineQueue !== false,

      ...config
    }

    // 网络状态
    this.isInitialized = false
    this.isConnected = false
    this.localPeerId = null // 本地节点ID（使用DID）

    // 连接管理
    this.peers = new Map() // peerId -> RTCPeerConnection
    this.dataChannels = new Map() // peerId -> RTCDataChannel
    this.signalingSocket = null
    this.connectionStates = new Map() // peerId -> state

    // 消息管理
    this.messageQueue = [] // 离线消息队列
    this.messageHandlers = new Map() // messageType -> handler
    this.pendingOffers = new Map() // peerId -> offer
    this.pendingAnswers = new Map() // peerId -> answer

    // 事件监听器
    this.eventListeners = new Map()

    // 定时器
    this.heartbeatTimer = null
    this.reconnectTimer = null

    // NAT类型
    this.natType = null
    this.publicAddress = null

    // ICE候选收集
    this.iceGatheringComplete = new Map() // peerId -> boolean
    this.pendingIceCandidates = new Map() // peerId -> candidate[]

    // 连接质量监控
    this.connectionQuality = new Map() // peerId -> { rtt, packetLoss, bandwidth }
    this.qualityCheckTimer = null

    // 重连管理
    this.reconnectAttempts = new Map() // peerId -> attempts
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5
    this.reconnectBackoff = config.reconnectBackoff || 1000 // 指数退避基数
  }

  /**
   * 初始化P2P管理器
   * @param {string} peerId - 本地节点ID（通常使用DID）
   */
  async initialize(peerId) {
    console.log('[P2PManager] 初始化P2P网络...', { peerId })

    try {
      if (this.isInitialized) {
        console.warn('[P2PManager] P2P网络已初始化')
        return
      }

      if (!peerId) {
        throw new Error('节点ID不能为空')
      }

      this.localPeerId = peerId

      // 连接到信令服务器
      await this.connectSignalingServer()

      // 启动心跳
      this.startHeartbeat()

      // 启动连接质量监控
      this.startQualityMonitoring()

      // 检测NAT类型
      await this.detectNATType()

      this.isInitialized = true
      this.emit('initialized', { peerId: this.localPeerId })

      console.log('[P2PManager] ✅ P2P网络初始化成功')
    } catch (error) {
      console.error('[P2PManager] ❌ P2P网络初始化失败:', error)
      throw error
    }
  }

  /**
   * 连接到信令服务器
   */
  async connectSignalingServer() {
    return new Promise((resolve, reject) => {
      try {
        console.log('[P2PManager] 连接信令服务器...', this.config.signalingServer)

        // 使用uni-app的WebSocket API
        this.signalingSocket = uni.connectSocket({
          url: this.config.signalingServer,
          success: () => {
            console.log('[P2PManager] WebSocket连接已建立')
          },
          fail: (err) => {
            console.error('[P2PManager] WebSocket连接失败:', err)
            reject(new Error('信令服务器连接失败'))
          }
        })

        // 监听打开事件
        this.signalingSocket.onOpen(() => {
          console.log('[P2PManager] ✅ 信令服务器连接成功')
          this.isConnected = true

          // 注册节点
          this.sendSignalingMessage({
            type: 'register',
            peerId: this.localPeerId,
            deviceType: 'mobile',
            deviceInfo: {
              name: uni.getSystemInfoSync().model || 'Unknown Device',
              platform: uni.getSystemInfoSync().platform || 'unknown',
              version: '0.16.0'
            }
          })

          this.emit('signaling:connected')
          resolve()
        })

        // 监听消息
        this.signalingSocket.onMessage((res) => {
          try {
            const message = JSON.parse(res.data)
            this.handleSignalingMessage(message)
          } catch (error) {
            console.error('[P2PManager] 解析信令消息失败:', error)
          }
        })

        // 监听错误
        this.signalingSocket.onError((err) => {
          console.error('[P2PManager] 信令服务器错误:', err)
          this.emit('signaling:error', err)

          // 自动重连
          if (this.config.enableAutoReconnect) {
            this.scheduleReconnect()
          }
        })

        // 监听关闭
        this.signalingSocket.onClose(() => {
          console.warn('[P2PManager] 信令服务器连接关闭')
          this.isConnected = false
          this.emit('signaling:disconnected')

          // 自动重连
          if (this.config.enableAutoReconnect) {
            this.scheduleReconnect()
          }
        })

      } catch (error) {
        console.error('[P2PManager] 创建WebSocket连接失败:', error)
        reject(error)
      }
    })
  }

  /**
   * 处理信令消息
   */
  async handleSignalingMessage(message) {
    console.log('[P2PManager] 收到信令消息:', message.type)

    try {
      switch (message.type) {
        case 'registered':
          console.log('[P2PManager] ✅ 节点注册成功:', message.peerId)
          this.emit('peer:registered', message)
          break

        case 'peers-list':
          console.log('[P2PManager] 在线节点列表:', message.count || 0)
          this.emit('peer:list', message.peers)
          break

        case 'peer-status':
          if (message.status === 'online') {
            console.log('[P2PManager] 节点上线:', message.peerId)
            this.emit('peer:online', message)
          } else if (message.status === 'offline') {
            console.log('[P2PManager] 节点离线:', message.peerId)
            this.handlePeerOffline(message.peerId)
          }
          break

        case 'peer-offline':
          console.log('[P2PManager] 节点离线（目标不可达）:', message.peerId)
          this.emit('peer:unreachable', message)
          break

        case 'offline-message':
          console.log('[P2PManager] 收到离线消息')
          this.emit('offline-message', message.originalMessage)
          break

        case 'offer':
          await this.handleOffer(message)
          break

        case 'answer':
          await this.handleAnswer(message)
          break

        case 'ice-candidate':
          await this.handleICECandidate(message)
          break

        case 'ice-candidates':
          await this.handleICECandidates(message)
          break

        case 'error':
          console.error('[P2PManager] 服务器错误:', message.error)
          this.emit('server:error', message)
          break

        default:
          console.warn('[P2PManager] 未知信令消息类型:', message.type)
      }
    } catch (error) {
      console.error('[P2PManager] 处理信令消息失败:', error)
    }
  }

  /**
   * 连接到对等节点
   * @param {string} peerId - 目标节点ID
   */
  async connectToPeer(peerId) {
    console.log('[P2PManager] 连接到节点:', peerId)

    try {
      if (this.peers.has(peerId)) {
        console.warn('[P2PManager] 已连接到该节点')
        return this.peers.get(peerId)
      }

      // 创建RTCPeerConnection
      const peerConnection = this.createPeerConnection(peerId)
      this.peers.set(peerId, peerConnection)

      // 创建DataChannel
      const dataChannel = peerConnection.createDataChannel('messaging', {
        ordered: true,
        maxRetransmits: 3
      })
      this.setupDataChannel(peerId, dataChannel)

      // 创建Offer
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      // 发送Offer到信令服务器
      this.sendSignalingMessage({
        type: 'offer',
        from: this.localPeerId,
        to: peerId,
        offer: peerConnection.localDescription
      })

      console.log('[P2PManager] Offer已发送到:', peerId)

    } catch (error) {
      console.error('[P2PManager] 连接节点失败:', error)
      this.peers.delete(peerId)
      throw error
    }
  }

  /**
   * 创建RTCPeerConnection
   */
  createPeerConnection(peerId) {
    console.log('[P2PManager] 创建RTCPeerConnection:', peerId)

    // 合并STUN和TURN服务器
    const iceServers = [
      ...this.config.iceServers,
      ...this.config.turnServers
    ]

    const peerConnection = new RTCPeerConnection({
      iceServers: iceServers
    })

    // ICE候选事件
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[P2PManager] 生成ICE候选:', peerId)

        // 批量收集ICE候选，减少信令消息数量
        if (!this.pendingIceCandidates.has(peerId)) {
          this.pendingIceCandidates.set(peerId, [])
        }
        this.pendingIceCandidates.get(peerId).push(event.candidate)

        // 延迟发送，等待更多候选
        setTimeout(() => {
          this.flushIceCandidates(peerId)
        }, 100)
      } else {
        // ICE候选收集完成
        console.log('[P2PManager] ICE候选收集完成:', peerId)
        this.iceGatheringComplete.set(peerId, true)
        this.flushIceCandidates(peerId) // 立即发送剩余候选
      }
    }

    // ICE收集状态变化
    peerConnection.onicegatheringstatechange = () => {
      console.log('[P2PManager] ICE收集状态:', peerId, peerConnection.iceGatheringState)
      if (peerConnection.iceGatheringState === 'complete') {
        this.iceGatheringComplete.set(peerId, true)
      }
    }

    // ICE连接状态变化
    peerConnection.oniceconnectionstatechange = () => {
      console.log('[P2PManager] ICE连接状态:', peerId, peerConnection.iceConnectionState)

      if (peerConnection.iceConnectionState === 'failed') {
        console.warn('[P2PManager] ICE连接失败，尝试重启ICE:', peerId)
        this.restartIce(peerId)
      } else if (peerConnection.iceConnectionState === 'disconnected') {
        console.warn('[P2PManager] ICE连接断开:', peerId)
        // 等待一段时间看是否能自动恢复
        setTimeout(() => {
          if (peerConnection.iceConnectionState === 'disconnected') {
            this.handleConnectionFailed(peerId)
          }
        }, 5000)
      }
    }

    // 连接状态变化
    peerConnection.onconnectionstatechange = () => {
      console.log('[P2PManager] 连接状态变化:', peerId, peerConnection.connectionState)
      this.connectionStates.set(peerId, peerConnection.connectionState)

      if (peerConnection.connectionState === 'connected') {
        this.emit('peer:connected', peerId)
      } else if (peerConnection.connectionState === 'disconnected') {
        this.emit('peer:disconnected', peerId)
      } else if (peerConnection.connectionState === 'failed') {
        this.handleConnectionFailed(peerId)
      }
    }

    // DataChannel事件（接收方）
    peerConnection.ondatachannel = (event) => {
      console.log('[P2PManager] 收到DataChannel:', peerId)
      this.setupDataChannel(peerId, event.channel)
    }

    return peerConnection
  }

  /**
   * 配置DataChannel
   */
  setupDataChannel(peerId, dataChannel) {
    console.log('[P2PManager] 配置DataChannel:', peerId)

    dataChannel.onopen = () => {
      console.log('[P2PManager] ✅ DataChannel已打开:', peerId)
      this.dataChannels.set(peerId, dataChannel)
      this.emit('channel:open', peerId)

      // 发送离线消息队列
      this.flushMessageQueue(peerId)
    }

    dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        console.log('[P2PManager] 收到P2P消息:', message.type)
        this.handleP2PMessage(peerId, message)
      } catch (error) {
        console.error('[P2PManager] 解析P2P消息失败:', error)
      }
    }

    dataChannel.onerror = (error) => {
      console.error('[P2PManager] DataChannel错误:', peerId, error)
      this.emit('channel:error', { peerId, error })
    }

    dataChannel.onclose = () => {
      console.warn('[P2PManager] DataChannel已关闭:', peerId)
      this.dataChannels.delete(peerId)
      this.emit('channel:close', peerId)
    }
  }

  /**
   * 处理Offer
   */
  async handleOffer(message) {
    const { from, offer } = message
    console.log('[P2PManager] 处理Offer:', from)

    try {
      // 创建RTCPeerConnection
      let peerConnection = this.peers.get(from)
      if (!peerConnection) {
        peerConnection = this.createPeerConnection(from)
        this.peers.set(from, peerConnection)
      }

      // 设置远程描述
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))

      // 创建Answer
      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)

      // 发送Answer
      this.sendSignalingMessage({
        type: 'answer',
        from: this.localPeerId,
        to: from,
        answer: peerConnection.localDescription
      })

      console.log('[P2PManager] Answer已发送:', from)

    } catch (error) {
      console.error('[P2PManager] 处理Offer失败:', error)
    }
  }

  /**
   * 处理Answer
   */
  async handleAnswer(message) {
    const { from, answer } = message
    console.log('[P2PManager] 处理Answer:', from)

    try {
      const peerConnection = this.peers.get(from)
      if (!peerConnection) {
        console.error('[P2PManager] 找不到PeerConnection:', from)
        return
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
      console.log('[P2PManager] ✅ Answer已处理:', from)

    } catch (error) {
      console.error('[P2PManager] 处理Answer失败:', error)
    }
  }

  /**
   * 处理ICE候选
   */
  async handleICECandidate(message) {
    const { from, candidate } = message

    try {
      const peerConnection = this.peers.get(from)
      if (!peerConnection) {
        console.error('[P2PManager] 找不到PeerConnection:', from)
        return
      }

      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))

    } catch (error) {
      console.error('[P2PManager] 处理ICE候选失败:', error)
    }
  }

  /**
   * 处理批量ICE候选
   */
  async handleICECandidates(message) {
    const { from, candidates } = message

    if (!candidates || candidates.length === 0) return

    console.log(`[P2PManager] 处理批量ICE候选: ${candidates.length}个`, from)

    try {
      const peerConnection = this.peers.get(from)
      if (!peerConnection) {
        console.error('[P2PManager] 找不到PeerConnection:', from)
        return
      }

      // 批量添加ICE候选
      for (const candidate of candidates) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (error) {
          console.error('[P2PManager] 添加ICE候选失败:', error)
        }
      }

      console.log(`[P2PManager] ✅ 已添加 ${candidates.length} 个ICE候选`)
    } catch (error) {
      console.error('[P2PManager] 处理批量ICE候选失败:', error)
    }
  }

  /**
   * 发送消息到对等节点
   * @param {string} peerId - 目标节点ID
   * @param {Object} message - 消息内容
   */
  async sendMessage(peerId, message) {
    try {
      const dataChannel = this.dataChannels.get(peerId)

      if (!dataChannel || dataChannel.readyState !== 'open') {
        console.warn('[P2PManager] DataChannel未就绪，加入离线队列:', peerId)

        if (this.config.enableOfflineQueue) {
          this.messageQueue.push({ peerId, message })
          if (this.messageQueue.length > this.config.messageQueueSize) {
            this.messageQueue.shift() // 移除最早的消息
          }
        }

        // 尝试重新连接
        if (!this.peers.has(peerId)) {
          await this.connectToPeer(peerId)
        }

        return false
      }

      // 发送消息
      dataChannel.send(JSON.stringify(message))
      console.log('[P2PManager] ✅ 消息已发送:', message.type)
      return true

    } catch (error) {
      console.error('[P2PManager] 发送消息失败:', error)
      return false
    }
  }

  /**
   * 处理P2P消息
   */
  handleP2PMessage(peerId, message) {
    const handler = this.messageHandlers.get(message.type)

    if (handler) {
      handler(peerId, message)
    } else {
      console.warn('[P2PManager] 未注册的消息类型:', message.type)
    }

    this.emit('message', { peerId, message })
  }

  /**
   * 注册消息处理器
   * @param {string} messageType - 消息类型
   * @param {Function} handler - 处理函数 (peerId, message) => void
   */
  onMessage(messageType, handler) {
    this.messageHandlers.set(messageType, handler)
  }

  /**
   * 发送信令消息
   */
  sendSignalingMessage(message) {
    if (!this.signalingSocket) {
      console.error('[P2PManager] 信令服务器未连接')
      return
    }

    try {
      this.signalingSocket.send({
        data: JSON.stringify(message)
      })
    } catch (error) {
      console.error('[P2PManager] 发送信令消息失败:', error)
    }
  }

  /**
   * 刷新消息队列
   */
  flushMessageQueue(peerId) {
    const messages = this.messageQueue.filter(item => item.peerId === peerId)

    if (messages.length === 0) return

    console.log('[P2PManager] 发送离线消息队列:', messages.length)

    messages.forEach(item => {
      this.sendMessage(item.peerId, item.message)
    })

    // 从队列中移除已发送的消息
    this.messageQueue = this.messageQueue.filter(item => item.peerId !== peerId)
  }

  /**
   * 处理节点离线
   */
  handlePeerOffline(peerId) {
    const peerConnection = this.peers.get(peerId)
    if (peerConnection) {
      peerConnection.close()
      this.peers.delete(peerId)
    }

    this.dataChannels.delete(peerId)
    this.connectionStates.delete(peerId)
    this.emit('peer:offline', peerId)
  }

  /**
   * 处理连接失败
   */
  handleConnectionFailed(peerId) {
    console.error('[P2PManager] 连接失败:', peerId)

    const attempts = this.reconnectAttempts.get(peerId) || 0

    if (attempts < this.maxReconnectAttempts) {
      // 指数退避重连
      const delay = this.reconnectBackoff * Math.pow(2, attempts)
      console.log(`[P2PManager] 将在 ${delay}ms 后重连 (尝试 ${attempts + 1}/${this.maxReconnectAttempts})`)

      setTimeout(async () => {
        try {
          this.reconnectAttempts.set(peerId, attempts + 1)
          await this.reconnectToPeer(peerId)
        } catch (error) {
          console.error('[P2PManager] 重连失败:', error)
          this.handleConnectionFailed(peerId) // 递归重试
        }
      }, delay)
    } else {
      console.error('[P2PManager] 达到最大重连次数，放弃连接:', peerId)
      this.handlePeerOffline(peerId)
      this.reconnectAttempts.delete(peerId)
      this.emit('connection:failed', { peerId, reason: 'max_retries_exceeded' })
    }
  }

  /**
   * 重连到对等节点
   */
  async reconnectToPeer(peerId) {
    console.log('[P2PManager] 重连到节点:', peerId)

    // 清理旧连接
    const oldConnection = this.peers.get(peerId)
    if (oldConnection) {
      oldConnection.close()
      this.peers.delete(peerId)
    }
    this.dataChannels.delete(peerId)
    this.connectionStates.delete(peerId)
    this.iceGatheringComplete.delete(peerId)
    this.pendingIceCandidates.delete(peerId)

    // 建立新连接
    await this.connectToPeer(peerId)
  }

  /**
   * 重启ICE
   */
  async restartIce(peerId) {
    console.log('[P2PManager] 重启ICE:', peerId)

    try {
      const peerConnection = this.peers.get(peerId)
      if (!peerConnection) {
        console.error('[P2PManager] 找不到PeerConnection:', peerId)
        return
      }

      // 创建新的Offer with iceRestart
      const offer = await peerConnection.createOffer({ iceRestart: true })
      await peerConnection.setLocalDescription(offer)

      // 发送新的Offer
      this.sendSignalingMessage({
        type: 'offer',
        from: this.localPeerId,
        to: peerId,
        offer: peerConnection.localDescription,
        iceRestart: true
      })

      console.log('[P2PManager] ICE重启Offer已发送:', peerId)
    } catch (error) {
      console.error('[P2PManager] ICE重启失败:', error)
      this.handleConnectionFailed(peerId)
    }
  }

  /**
   * 批量发送ICE候选
   */
  flushIceCandidates(peerId) {
    const candidates = this.pendingIceCandidates.get(peerId)
    if (!candidates || candidates.length === 0) return

    console.log(`[P2PManager] 批量发送 ${candidates.length} 个ICE候选:`, peerId)

    // 发送批量候选
    this.sendSignalingMessage({
      type: 'ice-candidates',
      from: this.localPeerId,
      to: peerId,
      candidates: candidates
    })

    // 清空待发送队列
    this.pendingIceCandidates.set(peerId, [])
  }

  /**
   * 启动连接质量监控
   */
  startQualityMonitoring() {
    if (this.qualityCheckTimer) {
      clearInterval(this.qualityCheckTimer)
    }

    this.qualityCheckTimer = setInterval(async () => {
      for (const [peerId, peerConnection] of this.peers) {
        try {
          const stats = await peerConnection.getStats()
          const quality = this.analyzeConnectionQuality(stats)

          this.connectionQuality.set(peerId, quality)

          // 如果连接质量很差，触发警告
          if (quality.score < 30) {
            console.warn('[P2PManager] 连接质量差:', peerId, quality)
            this.emit('connection:poor-quality', { peerId, quality })
          }

          // 如果连接质量极差，考虑重连
          if (quality.score < 10) {
            console.error('[P2PManager] 连接质量极差，考虑重连:', peerId)
            this.handleConnectionFailed(peerId)
          }
        } catch (error) {
          console.error('[P2PManager] 获取连接统计失败:', peerId, error)
        }
      }
    }, 10000) // 每10秒检查一次
  }

  /**
   * 分析连接质量
   */
  analyzeConnectionQuality(stats) {
    let rtt = 0
    let packetLoss = 0
    let bandwidth = 0
    let jitter = 0

    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        rtt = report.currentRoundTripTime * 1000 || 0 // 转换为ms
      }

      if (report.type === 'inbound-rtp') {
        const packetsLost = report.packetsLost || 0
        const packetsReceived = report.packetsReceived || 0
        if (packetsReceived > 0) {
          packetLoss = (packetsLost / (packetsLost + packetsReceived)) * 100
        }
        jitter = report.jitter || 0
      }

      if (report.type === 'outbound-rtp') {
        bandwidth = report.bytesSent || 0
      }
    })

    // 计算质量分数 (0-100)
    let score = 100

    // RTT影响 (>200ms开始扣分)
    if (rtt > 200) {
      score -= Math.min(30, (rtt - 200) / 10)
    }

    // 丢包率影响 (>1%开始扣分)
    if (packetLoss > 1) {
      score -= Math.min(40, packetLoss * 10)
    }

    // 抖动影响 (>30ms开始扣分)
    if (jitter > 30) {
      score -= Math.min(20, (jitter - 30) / 5)
    }

    score = Math.max(0, Math.min(100, score))

    return {
      rtt: Math.round(rtt),
      packetLoss: Math.round(packetLoss * 100) / 100,
      bandwidth: Math.round(bandwidth / 1024), // KB
      jitter: Math.round(jitter),
      score: Math.round(score)
    }
  }

  /**
   * 获取连接质量
   */
  getConnectionQuality(peerId) {
    return this.connectionQuality.get(peerId) || null
  }

  /**
   * 检测NAT类型
   */
  async detectNATType() {
    // TODO: 实现STUN-based NAT检测
    console.log('[P2PManager] NAT类型检测（待实现）')
    this.natType = 'unknown'
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.sendSignalingMessage({
          type: 'heartbeat',
          peerId: this.localPeerId
        })
      }
    }, this.config.heartbeatInterval)
  }

  /**
   * 计划重连
   */
  scheduleReconnect() {
    if (this.reconnectTimer) return

    console.log('[P2PManager] 计划重连...', this.config.reconnectInterval)

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null

      try {
        await this.connectSignalingServer()
      } catch (error) {
        console.error('[P2PManager] 重连失败:', error)
        this.scheduleReconnect()
      }
    }, this.config.reconnectInterval)
  }

  /**
   * 请求在线节点列表
   */
  async requestPeersList() {
    this.sendSignalingMessage({
      type: 'get-peers'
    })
  }

  /**
   * 获取连接状态
   */
  getConnectionState(peerId) {
    return this.connectionStates.get(peerId) || 'disconnected'
  }

  /**
   * 获取所有在线节点
   */
  getOnlinePeers() {
    return Array.from(this.peers.keys())
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      isConnected: this.isConnected,
      peersCount: this.peers.size,
      dataChannelsCount: this.dataChannels.size,
      messageQueueSize: this.messageQueue.length,
      natType: this.natType
    }
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event).push(callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach(callback => callback(data))
    }
  }

  /**
   * 断开连接
   */
  async disconnect(peerId) {
    console.log('[P2PManager] 断开连接:', peerId)

    const peerConnection = this.peers.get(peerId)
    if (peerConnection) {
      peerConnection.close()
      this.peers.delete(peerId)
    }

    this.dataChannels.delete(peerId)
    this.connectionStates.delete(peerId)
  }

  /**
   * 关闭P2P管理器
   */
  async shutdown() {
    console.log('[P2PManager] 关闭P2P网络...')

    // 清除定时器
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.qualityCheckTimer) {
      clearInterval(this.qualityCheckTimer)
      this.qualityCheckTimer = null
    }

    // 关闭所有peer连接
    for (const [peerId, peerConnection] of this.peers) {
      peerConnection.close()
    }
    this.peers.clear()
    this.dataChannels.clear()
    this.connectionStates.clear()
    this.iceGatheringComplete.clear()
    this.pendingIceCandidates.clear()
    this.connectionQuality.clear()
    this.reconnectAttempts.clear()

    // 关闭信令服务器连接
    if (this.signalingSocket) {
      this.signalingSocket.close()
      this.signalingSocket = null
    }

    this.isInitialized = false
    this.isConnected = false
    this.emit('shutdown')

    console.log('[P2PManager] ✅ P2P网络已关闭')
  }
}

// 导出单例
let p2pManagerInstance = null

export function getP2PManager(config) {
  if (!p2pManagerInstance) {
    p2pManagerInstance = new P2PManager(config)
  }
  return p2pManagerInstance
}

export default P2PManager
