<template>
  <view class="pc-status-container">
    <!-- 设备头部 -->
    <view class="device-header">
      <view class="device-info">
        <text class="device-name">{{ deviceName }}</text>
        <text class="device-status" :class="{ online: isConnected }">
          <text class="status-dot"></text>
          {{ isConnected ? '在线' : '离线' }}
        </text>
      </view>
      <button class="btn-refresh" @tap="refreshAll" :disabled="!isConnected">
        <text class="refresh-icon" :class="{ rotating: refreshing }">🔄</text>
      </button>
    </view>

    <!-- 加载状态 -->
    <view class="loading-container" v-if="loading">
      <view class="loading-icon"></view>
      <text class="loading-text">加载中...</text>
    </view>

    <!-- 离线提示 -->
    <view class="offline-tip" v-else-if="!isConnected">
      <text class="offline-icon">📡</text>
      <text class="offline-text">PC设备当前离线</text>
      <text class="offline-subtitle">请确保PC端应用正在运行</text>
      <button class="btn-reconnect" @tap="reconnect">尝试重连</button>
    </view>

    <!-- 状态内容 -->
    <scroll-view class="status-content" scroll-y v-else>
      <!-- 系统信息卡片 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">💻 系统信息</text>
        </view>
        <view class="card-body">
          <view class="info-row">
            <text class="info-label">主机名</text>
            <text class="info-value">{{ systemInfo?.hostname || '-' }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">平台</text>
            <text class="info-value">{{ systemInfo?.platform || '-' }} ({{ systemInfo?.arch || '-' }})</text>
          </view>
          <view class="info-row">
            <text class="info-label">系统版本</text>
            <text class="info-value">{{ systemInfo?.release || '-' }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">CPU型号</text>
            <text class="info-value">{{ systemInfo?.cpuModel || '-' }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">CPU核心数</text>
            <text class="info-value">{{ systemInfo?.cpuCores || '-' }}核</text>
          </view>
          <view class="info-row">
            <text class="info-label">总内存</text>
            <text class="info-value">{{ formatBytes(systemInfo?.totalMemory) }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">可用内存</text>
            <text class="info-value">{{ formatBytes(systemInfo?.freeMemory) }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">运行时间</text>
            <text class="info-value">{{ formatUptime(systemInfo?.uptime) }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">Node版本</text>
            <text class="info-value">{{ systemInfo?.nodeVersion || '-' }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">应用版本</text>
            <text class="info-value">{{ systemInfo?.appVersion || '-' }}</text>
          </view>
        </view>
      </view>

      <!-- 服务状态卡片 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">⚙️ 服务状态</text>
        </view>
        <view class="card-body">
          <view class="service-item" v-for="service in services" :key="service.name">
            <view class="service-info">
              <text class="service-name">{{ service.name }}</text>
              <view class="service-status" :class="service.status">
                <text class="service-status-text">{{ getServiceStatusText(service.status) }}</text>
              </view>
            </view>
            <view class="service-details" v-if="service.details">
              <view class="detail-item" v-for="(value, key) in service.details" :key="key">
                <text class="detail-label">{{ formatDetailKey(key) }}:</text>
                <text class="detail-value">{{ formatDetailValue(key, value) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 实时监控卡片 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">📊 实时监控</text>
          <text class="card-subtitle">{{ autoRefresh ? '自动刷新中' : '已暂停' }}</text>
          <switch :checked="autoRefresh" @change="toggleAutoRefresh" />
        </view>
        <view class="card-body">
          <!-- CPU使用率 -->
          <view class="monitor-item">
            <view class="monitor-header">
              <text class="monitor-label">CPU使用率</text>
              <text class="monitor-value">{{ realtimeData?.cpu?.usage || 0 }}%</text>
            </view>
            <view class="progress-bar">
              <view
                class="progress-fill"
                :class="getUsageLevel(realtimeData?.cpu?.usage)"
                :style="{ width: (realtimeData?.cpu?.usage || 0) + '%' }"
              ></view>
            </view>
            <text class="monitor-meta">{{ realtimeData?.cpu?.cores || 0 }}核心</text>
          </view>

          <!-- 内存使用率 -->
          <view class="monitor-item">
            <view class="monitor-header">
              <text class="monitor-label">内存使用率</text>
              <text class="monitor-value">{{ realtimeData?.memory?.usagePercent || 0 }}%</text>
            </view>
            <view class="progress-bar">
              <view
                class="progress-fill"
                :class="getUsageLevel(realtimeData?.memory?.usagePercent)"
                :style="{ width: (realtimeData?.memory?.usagePercent || 0) + '%' }"
              ></view>
            </view>
            <text class="monitor-meta">
              已用 {{ formatBytes(realtimeData?.memory?.used) }} /
              总计 {{ formatBytes(realtimeData?.memory?.total) }}
            </text>
          </view>

          <!-- 磁盘使用率 -->
          <view class="monitor-item">
            <view class="monitor-header">
              <text class="monitor-label">磁盘使用率</text>
              <text class="monitor-value">{{ realtimeData?.disk?.usagePercent || 0 }}%</text>
            </view>
            <view class="progress-bar">
              <view
                class="progress-fill"
                :class="getUsageLevel(realtimeData?.disk?.usagePercent)"
                :style="{ width: (realtimeData?.disk?.usagePercent || 0) + '%' }"
              ></view>
            </view>
            <text class="monitor-meta">
              可用 {{ formatBytes(realtimeData?.disk?.available) }} /
              总计 {{ formatBytes(realtimeData?.disk?.total) }}
            </text>
          </view>

          <!-- 更新时间 -->
          <view class="monitor-timestamp">
            <text class="timestamp-text">
              最后更新: {{ formatTimestamp(realtimeData?.timestamp) }}
            </text>
          </view>
        </view>
      </view>

      <!-- 快捷操作 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">🔧 快捷操作</text>
        </view>
        <view class="card-body">
          <button class="quick-action-btn" @tap="viewKnowledge">
            <text class="quick-action-icon">📚</text>
            <text class="quick-action-text">查看知识库</text>
          </button>
          <button class="quick-action-btn" @tap="viewProjects">
            <text class="quick-action-icon">📁</text>
            <text class="quick-action-text">查看项目</text>
          </button>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { getP2PManager } from '@/services/p2p/p2p-manager'

export default {
  data() {
    return {
      peerId: '',
      deviceName: 'PC设备',
      loading: true,
      refreshing: false,
      isConnected: false,

      // P2P管理器
      p2pManager: null,

      // 系统信息
      systemInfo: null,

      // 服务状态
      services: [],

      // 实时监控数据
      realtimeData: null,

      // 自动刷新
      autoRefresh: true,
      refreshTimer: null,
      refreshInterval: 5000, // 5秒刷新一次

      // 请求ID映射
      pendingRequests: new Map()
    }
  },

  async onLoad(options) {
    this.peerId = options.peerId || ''
    this.deviceName = decodeURIComponent(options.deviceName || 'PC设备')

    if (!this.peerId) {
      uni.showToast({
        title: '缺少设备ID',
        icon: 'none'
      })
      setTimeout(() => {
        uni.navigateBack()
      }, 1500)
      return
    }

    await this.initP2P()
    await this.loadAllData()
  },

  onUnload() {
    // 停止自动刷新
    this.stopAutoRefresh()

    // 移除消息监听
    if (this.p2pManager) {
      this.p2pManager.eventListeners.clear()
    }
  },

  methods: {
    /**
     * 初始化P2P管理器
     */
    async initP2P() {
      try {
        this.p2pManager = getP2PManager()

        if (!this.p2pManager.isInitialized) {
          uni.showToast({
            title: 'P2P未初始化',
            icon: 'none'
          })
          return
        }

        // 检查连接状态
        this.isConnected = this.p2pManager.getConnectionState(this.peerId) === 'connected'

        // 监听消息
        this.p2pManager.on('message', this.handleMessage)
        this.p2pManager.on('peer:disconnected', this.handlePeerDisconnected)
        this.p2pManager.on('peer:offline', this.handlePeerOffline)

        console.log('[PCStatus] P2P管理器初始化成功')
      } catch (error) {
        console.error('[PCStatus] P2P初始化失败:', error)
      }
    },

    /**
     * 加载所有数据
     */
    async loadAllData() {
      try {
        this.loading = true

        // 并行请求三个接口
        await Promise.all([
          this.fetchSystemInfo(),
          this.fetchServicesStatus(),
          this.fetchRealtimeData()
        ])

        // 启动自动刷新
        if (this.autoRefresh) {
          this.startAutoRefresh()
        }
      } catch (error) {
        console.error('[PCStatus] 加载数据失败:', error)
      } finally {
        this.loading = false
      }
    },

    /**
     * 获取系统信息
     */
    async fetchSystemInfo() {
      return this.sendP2PRequest('pc-status:get-system-info', {})
    },

    /**
     * 获取服务状态
     */
    async fetchServicesStatus() {
      return this.sendP2PRequest('pc-status:get-services-status', {})
    },

    /**
     * 获取实时监控数据
     */
    async fetchRealtimeData() {
      return this.sendP2PRequest('pc-status:get-realtime', {})
    },

    /**
     * 发送P2P请求
     */
    async sendP2PRequest(type, params) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected) {
          reject(new Error('设备未连接'))
          return
        }

        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        // 保存请求回调
        this.pendingRequests.set(requestId, { resolve, reject, type })

        // 发送消息
        this.p2pManager.sendMessage(this.peerId, {
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
    },

    /**
     * 处理P2P消息
     */
    handleMessage({ peerId, message }) {
      if (peerId !== this.peerId) return

      const { requestId, type, data, error } = message

      // 查找对应的请求
      const request = this.pendingRequests.get(requestId)
      if (!request) return

      this.pendingRequests.delete(requestId)

      if (error) {
        request.reject(new Error(error))
        return
      }

      // 根据响应类型处理数据
      if (type === 'pc-status:get-system-info:response') {
        this.systemInfo = data.systemInfo
        request.resolve(data)
      } else if (type === 'pc-status:get-services-status:response') {
        this.services = data.services || []
        request.resolve(data)
      } else if (type === 'pc-status:get-realtime:response') {
        this.realtimeData = data
        request.resolve(data)
      }
    },

    /**
     * 处理节点断开
     */
    handlePeerDisconnected(peerId) {
      if (peerId === this.peerId) {
        this.isConnected = false
        this.stopAutoRefresh()
        uni.showToast({
          title: 'PC设备已断开',
          icon: 'none'
        })
      }
    },

    /**
     * 处理节点离线
     */
    handlePeerOffline(peerId) {
      if (peerId === this.peerId) {
        this.isConnected = false
        this.stopAutoRefresh()
        uni.showToast({
          title: 'PC设备离线',
          icon: 'none'
        })
      }
    },

    /**
     * 刷新所有数据
     */
    async refreshAll() {
      if (this.refreshing) return

      try {
        this.refreshing = true

        await Promise.all([
          this.fetchSystemInfo(),
          this.fetchServicesStatus(),
          this.fetchRealtimeData()
        ])

        uni.showToast({
          title: '刷新成功',
          icon: 'success'
        })
      } catch (error) {
        console.error('[PCStatus] 刷新失败:', error)
        uni.showToast({
          title: '刷新失败',
          icon: 'none'
        })
      } finally {
        this.refreshing = false
      }
    },

    /**
     * 重连设备
     */
    async reconnect() {
      try {
        uni.showLoading({
          title: '连接中...'
        })

        await this.p2pManager.connectToPeer(this.peerId)

        this.isConnected = true
        uni.hideLoading()
        uni.showToast({
          title: '连接成功',
          icon: 'success'
        })

        // 重新加载数据
        await this.loadAllData()
      } catch (error) {
        console.error('[PCStatus] 重连失败:', error)
        uni.hideLoading()
        uni.showToast({
          title: '连接失败',
          icon: 'none'
        })
      }
    },

    /**
     * 切换自动刷新
     */
    toggleAutoRefresh(e) {
      this.autoRefresh = e.detail.value

      if (this.autoRefresh) {
        this.startAutoRefresh()
      } else {
        this.stopAutoRefresh()
      }
    },

    /**
     * 启动自动刷新
     */
    startAutoRefresh() {
      if (this.refreshTimer) return

      this.refreshTimer = setInterval(async () => {
        if (this.isConnected) {
          try {
            await this.fetchRealtimeData()
          } catch (error) {
            console.error('[PCStatus] 自动刷新失败:', error)
          }
        }
      }, this.refreshInterval)
    },

    /**
     * 停止自动刷新
     */
    stopAutoRefresh() {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer)
        this.refreshTimer = null
      }
    },

    /**
     * 查看知识库
     */
    viewKnowledge() {
      uni.navigateTo({
        url: `/pages/p2p/knowledge-list?peerId=${this.peerId}`
      })
    },

    /**
     * 查看项目
     */
    viewProjects() {
      uni.navigateTo({
        url: `/pages/p2p/project-list?peerId=${this.peerId}`
      })
    },

    /**
     * 格式化字节
     */
    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B'

      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))

      return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
    },

    /**
     * 格式化运行时间
     */
    formatUptime(seconds) {
      if (!seconds) return '-'

      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)

      const parts = []
      if (days > 0) parts.push(`${days}天`)
      if (hours > 0) parts.push(`${hours}小时`)
      if (minutes > 0) parts.push(`${minutes}分钟`)

      return parts.join(' ') || '0分钟'
    },

    /**
     * 格式化时间戳
     */
    formatTimestamp(timestamp) {
      if (!timestamp) return '-'

      const date = new Date(timestamp)
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')

      return `${hours}:${minutes}:${seconds}`
    },

    /**
     * 获取服务状态文本
     */
    getServiceStatusText(status) {
      const statusMap = {
        running: '运行中',
        stopped: '已停止',
        error: '错误',
        unknown: '未知',
        configured: '已配置'
      }
      return statusMap[status] || status
    },

    /**
     * 格式化详情键
     */
    formatDetailKey(key) {
      const keyMap = {
        peerId: '节点ID',
        connectedPeers: '已连接节点',
        provider: '服务商',
        notesCount: '笔记数量',
        type: '类型'
      }
      return keyMap[key] || key
    },

    /**
     * 格式化详情值
     */
    formatDetailValue(key, value) {
      if (key === 'peerId' && typeof value === 'string' && value.length > 20) {
        return `${value.slice(0, 10)}...${value.slice(-10)}`
      }
      return String(value)
    },

    /**
     * 获取使用率级别
     */
    getUsageLevel(usage) {
      if (usage < 50) return 'low'
      if (usage < 80) return 'medium'
      return 'high'
    }
  }
}
</script>

<style scoped>
.pc-status-container {
  min-height: 100vh;
  background-color: #f5f5f5;
}

/* 设备头部 */
.device-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 30rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #e8e8e8;
}

.device-info {
  flex: 1;
}

.device-name {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 8rpx;
}

.device-status {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  font-size: 24rpx;
  color: #999;
}

.device-status.online {
  color: #52c41a;
}

.status-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background-color: #d9d9d9;
}

.device-status.online .status-dot {
  background-color: #52c41a;
}

.btn-refresh {
  width: 70rpx;
  height: 70rpx;
  border-radius: 35rpx;
  background-color: #1890ff;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.btn-refresh[disabled] {
  background-color: #d9d9d9;
}

.refresh-icon {
  font-size: 36rpx;
}

.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 加载状态 */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 150rpx 0;
}

.loading-icon {
  width: 60rpx;
  height: 60rpx;
  border: 4rpx solid #f3f3f3;
  border-top: 4rpx solid #1890ff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20rpx;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-text {
  font-size: 28rpx;
  color: #999;
}

/* 离线提示 */
.offline-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 150rpx 40rpx;
}

.offline-icon {
  font-size: 120rpx;
  margin-bottom: 30rpx;
}

.offline-text {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 15rpx;
}

.offline-subtitle {
  font-size: 26rpx;
  color: #999;
  margin-bottom: 40rpx;
}

.btn-reconnect {
  padding: 16rpx 50rpx;
  background-color: #1890ff;
  color: #fff;
  border-radius: 40rpx;
  border: none;
  font-size: 28rpx;
}

/* 状态内容 */
.status-content {
  height: calc(100vh - 110rpx);
  padding: 20rpx;
}

/* 卡片 */
.card {
  background-color: #fff;
  border-radius: 16rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.card-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

.card-subtitle {
  font-size: 24rpx;
  color: #999;
  margin-right: 20rpx;
}

.card-body {
  padding: 30rpx;
}

/* 信息行 */
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-size: 28rpx;
  color: #666;
}

.info-value {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
  text-align: right;
  max-width: 60%;
  word-break: break-all;
}

/* 服务项 */
.service-item {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.service-item:last-child {
  border-bottom: none;
}

.service-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15rpx;
}

.service-name {
  font-size: 28rpx;
  font-weight: 500;
  color: #333;
}

.service-status {
  padding: 6rpx 16rpx;
  border-radius: 16rpx;
  font-size: 24rpx;
}

.service-status.running {
  background-color: #f6ffed;
  color: #52c41a;
}

.service-status.stopped {
  background-color: #fff2e8;
  color: #fa8c16;
}

.service-status.error {
  background-color: #fff1f0;
  color: #ff4d4f;
}

.service-status.unknown,
.service-status.configured {
  background-color: #f0f0f0;
  color: #999;
}

.service-details {
  padding-left: 20rpx;
}

.detail-item {
  display: flex;
  gap: 10rpx;
  padding: 8rpx 0;
  font-size: 24rpx;
  color: #666;
}

.detail-label {
  color: #999;
}

.detail-value {
  color: #666;
}

/* 监控项 */
.monitor-item {
  padding: 25rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.monitor-item:last-child {
  border-bottom: none;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15rpx;
}

.monitor-label {
  font-size: 28rpx;
  color: #666;
}

.monitor-value {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

.progress-bar {
  height: 20rpx;
  background-color: #f0f0f0;
  border-radius: 10rpx;
  overflow: hidden;
  margin-bottom: 10rpx;
}

.progress-fill {
  height: 100%;
  border-radius: 10rpx;
  transition: width 0.3s;
}

.progress-fill.low {
  background-color: #52c41a;
}

.progress-fill.medium {
  background-color: #faad14;
}

.progress-fill.high {
  background-color: #ff4d4f;
}

.monitor-meta {
  font-size: 24rpx;
  color: #999;
}

.monitor-timestamp {
  padding-top: 20rpx;
  text-align: center;
}

.timestamp-text {
  font-size: 24rpx;
  color: #999;
}

/* 快捷操作按钮 */
.quick-action-btn {
  display: flex;
  align-items: center;
  gap: 15rpx;
  padding: 25rpx;
  background-color: #fafafa;
  border-radius: 12rpx;
  border: 1rpx solid #e8e8e8;
  margin-bottom: 15rpx;
}

.quick-action-btn:last-child {
  margin-bottom: 0;
}

.quick-action-icon {
  font-size: 40rpx;
}

.quick-action-text {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}
</style>
