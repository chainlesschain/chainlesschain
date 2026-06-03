<template>
  <view class="device-list-container">
    <!-- 头部统计 -->
    <view class="header-stats">
      <view class="stat-card">
        <text class="stat-value">{{ devices.length }}</text>
        <text class="stat-label">已配对设备</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ connectedCount }}</text>
        <text class="stat-label">在线</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ disconnectedCount }}</text>
        <text class="stat-label">离线</text>
      </view>
    </view>

    <!-- 设备列表 -->
    <view class="devices-section">
      <view class="section-header">
        <text class="section-title">我的PC设备</text>
        <button class="btn-pair" @tap="goToPairing">
          <text class="btn-icon">+</text>
          <text class="btn-text">配对新设备</text>
        </button>
      </view>

      <!-- 加载状态 -->
      <view class="loading-container" v-if="loading">
        <view class="loading-icon"></view>
        <text class="loading-text">加载中...</text>
      </view>

      <!-- 空状态 -->
      <view class="empty-container" v-else-if="devices.length === 0">
        <text class="empty-icon">💻</text>
        <text class="empty-title">还没有配对的PC设备</text>
        <text class="empty-subtitle">点击上方按钮配对您的第一台PC设备</text>
      </view>

      <!-- 设备卡片列表 -->
      <view class="device-list" v-else>
        <view
          class="device-card"
          :class="{ connected: device.connected, disconnected: !device.connected }"
          v-for="device in devices"
          :key="device.peerId"
          @tap="handleDeviceTap(device)"
        >
          <!-- 设备信息 -->
          <view class="device-info">
            <view class="device-header">
              <text class="device-name">{{ device.deviceInfo?.name || 'PC设备' }}</text>
              <view class="device-status" :class="{ online: device.connected }">
                <text class="status-dot"></text>
                <text class="status-text">{{ device.connected ? '在线' : '离线' }}</text>
              </view>
            </view>

            <view class="device-meta">
              <text class="meta-item">
                <text class="meta-icon">💻</text>
                <text class="meta-text">{{ device.deviceInfo?.platform || '未知平台' }}</text>
              </text>
              <text class="meta-item" v-if="device.lastConnected">
                <text class="meta-icon">🕒</text>
                <text class="meta-text">{{ formatTime(device.lastConnected) }}</text>
              </text>
            </view>

            <!-- PeerID -->
            <view class="device-peer-id">
              <text class="peer-id-label">PeerID:</text>
              <text class="peer-id-value">{{ shortenPeerId(device.peerId) }}</text>
            </view>
          </view>

          <!-- 操作按钮 -->
          <view class="device-actions">
            <button
              class="action-btn"
              :class="{ primary: !device.connected, secondary: device.connected }"
              @tap.stop="toggleConnection(device)"
            >
              <text class="action-btn-text">{{ device.connected ? '断开' : '连接' }}</text>
            </button>
            <button class="action-btn secondary" @tap.stop="viewPCStatus(device)">
              <text class="action-btn-text">查看状态</text>
            </button>
            <button class="action-btn danger" @tap.stop="unpairDevice(device)">
              <text class="action-btn-text">取消配对</text>
            </button>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部说明 -->
    <view class="footer-tips">
      <text class="tip-text">💡 提示：PC设备需要保持ChainlessChain应用运行才能连接</text>
    </view>
  </view>
</template>

<script>
import { getP2PManager } from '@/services/p2p/p2p-manager'
import { getDIDService } from '@/services/did'

export default {
  data() {
    return {
      loading: true,
      devices: [], // 已配对的设备列表
      p2pManager: null,
      connectionStates: new Map() // peerId -> connection state
    }
  },

  computed: {
    connectedCount() {
      return this.devices.filter(d => d.connected).length
    },
    disconnectedCount() {
      return this.devices.filter(d => !d.connected).length
    }
  },

  async onLoad() {
    await this.initP2P()
    await this.loadDevices()
  },

  onShow() {
    // 刷新设备连接状态
    if (this.p2pManager) {
      this.updateConnectionStates()
    }
  },

  onUnload() {
    // 移除事件监听
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
        // 获取P2P管理器
        this.p2pManager = getP2PManager({
          signalingServer: 'ws://localhost:9001' // 本地开发环境
          // signalingServer: 'wss://chainlesschain.io/signal' // 生产环境
        })

        // 获取当前DID
        const didService = getDIDService()
        await didService.initialize()
        const identity = await didService.getCurrentIdentity()

        if (!identity) {
          uni.showModal({
            title: '提示',
            content: '请先创建DID身份',
            success: (res) => {
              if (res.confirm) {
                uni.navigateTo({
                  url: '/pages/identity/create'
                })
              }
            }
          })
          return
        }

        // 初始化P2P网络
        await this.p2pManager.initialize(identity.did)

        // 监听连接事件
        this.p2pManager.on('peer:connected', this.handlePeerConnected)
        this.p2pManager.on('peer:disconnected', this.handlePeerDisconnected)
        this.p2pManager.on('peer:offline', this.handlePeerOffline)

        console.log('[DeviceList] P2P管理器初始化成功')
      } catch (error) {
        console.error('[DeviceList] P2P初始化失败:', error)
        uni.showToast({
          title: 'P2P初始化失败',
          icon: 'none'
        })
      }
    },

    /**
     * 加载已配对的设备列表
     */
    async loadDevices() {
      try {
        this.loading = true

        // 从本地存储加载设备列表
        const devicesStr = uni.getStorageSync('paired_devices')
        let pairedDevices = []

        if (devicesStr) {
          pairedDevices = JSON.parse(devicesStr)
        }

        // 更新连接状态
        this.devices = pairedDevices.map(device => ({
          ...device,
          connected: this.p2pManager ? this.p2pManager.getConnectionState(device.peerId) === 'connected' : false
        }))

        console.log('[DeviceList] 已加载设备列表:', this.devices.length)
      } catch (error) {
        console.error('[DeviceList] 加载设备列表失败:', error)
      } finally {
        this.loading = false
      }
    },

    /**
     * 更新连接状态
     */
    updateConnectionStates() {
      this.devices = this.devices.map(device => ({
        ...device,
        connected: this.p2pManager.getConnectionState(device.peerId) === 'connected'
      }))
    },

    /**
     * 处理设备点击
     */
    handleDeviceTap(device) {
      if (device.connected) {
        // 如果已连接，导航到PC状态监控页面
        this.viewPCStatus(device)
      } else {
        // 如果未连接，尝试连接
        this.toggleConnection(device)
      }
    },

    /**
     * 切换连接状态
     */
    async toggleConnection(device) {
      try {
        if (device.connected) {
          // 断开连接
          await this.p2pManager.disconnect(device.peerId)
          uni.showToast({
            title: '已断开连接',
            icon: 'success'
          })
        } else {
          // 连接设备
          uni.showLoading({
            title: '连接中...'
          })

          await this.p2pManager.connectToPeer(device.peerId)

          uni.hideLoading()
          uni.showToast({
            title: '连接成功',
            icon: 'success'
          })

          // 更新最后连接时间
          device.lastConnected = Date.now()
          this.saveDevices()
        }

        this.updateConnectionStates()
      } catch (error) {
        console.error('[DeviceList] 连接操作失败:', error)
        uni.hideLoading()
        uni.showToast({
          title: error.message || '连接失败',
          icon: 'none'
        })
      }
    },

    /**
     * 查看PC状态
     */
    viewPCStatus(device) {
      if (!device.connected) {
        uni.showToast({
          title: '请先连接设备',
          icon: 'none'
        })
        return
      }

      uni.navigateTo({
        url: `/pages/p2p/pc-status?peerId=${device.peerId}&deviceName=${encodeURIComponent(device.deviceInfo?.name || 'PC设备')}`
      })
    },

    /**
     * 取消配对设备
     */
    unpairDevice(device) {
      uni.showModal({
        title: '确认取消配对',
        content: `确定要取消与「${device.deviceInfo?.name || 'PC设备'}」的配对吗？`,
        success: async (res) => {
          if (res.confirm) {
            try {
              // 如果已连接，先断开
              if (device.connected) {
                await this.p2pManager.disconnect(device.peerId)
              }

              // 从列表中移除
              this.devices = this.devices.filter(d => d.peerId !== device.peerId)
              this.saveDevices()

              uni.showToast({
                title: '已取消配对',
                icon: 'success'
              })
            } catch (error) {
              console.error('[DeviceList] 取消配对失败:', error)
              uni.showToast({
                title: '操作失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    /**
     * 保存设备列表到本地存储
     */
    saveDevices() {
      try {
        uni.setStorageSync('paired_devices', JSON.stringify(this.devices))
      } catch (error) {
        console.error('[DeviceList] 保存设备列表失败:', error)
      }
    },

    /**
     * 前往配对页面
     */
    goToPairing() {
      uni.navigateTo({
        url: '/pages/device-pairing/index'
      })
    },

    /**
     * 处理节点连接
     */
    handlePeerConnected(peerId) {
      console.log('[DeviceList] 节点已连接:', peerId)
      this.updateConnectionStates()
    },

    /**
     * 处理节点断开
     */
    handlePeerDisconnected(peerId) {
      console.log('[DeviceList] 节点已断开:', peerId)
      this.updateConnectionStates()
    },

    /**
     * 处理节点离线
     */
    handlePeerOffline(peerId) {
      console.log('[DeviceList] 节点离线:', peerId)
      this.updateConnectionStates()
    },

    /**
     * 缩短PeerID显示
     */
    shortenPeerId(peerId) {
      if (!peerId) return ''
      return peerId.length > 20 ? `${peerId.slice(0, 10)}...${peerId.slice(-10)}` : peerId
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      if (!timestamp) return '从未连接'

      const now = Date.now()
      const diff = now - timestamp

      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour

      if (diff < minute) {
        return '刚刚'
      } else if (diff < hour) {
        return `${Math.floor(diff / minute)}分钟前`
      } else if (diff < day) {
        return `${Math.floor(diff / hour)}小时前`
      } else {
        return `${Math.floor(diff / day)}天前`
      }
    }
  }
}
</script>

<style scoped>
.device-list-container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 20rpx;
}

/* 头部统计 */
.header-stats {
  display: flex;
  gap: 20rpx;
  margin-bottom: 30rpx;
}

.stat-card {
  flex: 1;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  text-align: center;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.stat-value {
  display: block;
  font-size: 48rpx;
  font-weight: bold;
  color: #1890ff;
  margin-bottom: 10rpx;
}

.stat-label {
  display: block;
  font-size: 24rpx;
  color: #999;
}

/* 设备列表区域 */
.devices-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30rpx;
}

.section-title {
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
}

.btn-pair {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 16rpx 30rpx;
  background-color: #1890ff;
  border-radius: 40rpx;
  border: none;
  font-size: 28rpx;
  color: #fff;
}

.btn-icon {
  font-size: 32rpx;
  font-weight: bold;
}

.btn-text {
  font-size: 28rpx;
}

/* 加载状态 */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 0;
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

/* 空状态 */
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx 40rpx;
}

.empty-icon {
  font-size: 120rpx;
  margin-bottom: 30rpx;
}

.empty-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 15rpx;
}

.empty-subtitle {
  font-size: 26rpx;
  color: #999;
  text-align: center;
}

/* 设备卡片 */
.device-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.device-card {
  border-radius: 16rpx;
  padding: 30rpx;
  background-color: #fafafa;
  border: 2rpx solid #e8e8e8;
  transition: all 0.3s;
}

.device-card.connected {
  border-color: #52c41a;
  background-color: #f6ffed;
}

.device-card.disconnected {
  border-color: #d9d9d9;
  opacity: 0.8;
}

.device-info {
  margin-bottom: 20rpx;
}

.device-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15rpx;
}

.device-name {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

.device-status {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 8rpx 16rpx;
  border-radius: 20rpx;
  background-color: #f5f5f5;
}

.device-status.online {
  background-color: #f6ffed;
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

.status-text {
  font-size: 24rpx;
  color: #999;
}

.device-status.online .status-text {
  color: #52c41a;
}

.device-meta {
  display: flex;
  gap: 30rpx;
  margin-bottom: 15rpx;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 24rpx;
  color: #666;
}

.meta-icon {
  font-size: 28rpx;
}

.device-peer-id {
  padding: 15rpx 20rpx;
  background-color: #f0f0f0;
  border-radius: 8rpx;
  font-size: 22rpx;
}

.peer-id-label {
  color: #999;
  margin-right: 10rpx;
}

.peer-id-value {
  color: #666;
  font-family: monospace;
}

/* 操作按钮 */
.device-actions {
  display: flex;
  gap: 15rpx;
}

.action-btn {
  flex: 1;
  height: 70rpx;
  line-height: 70rpx;
  border-radius: 35rpx;
  font-size: 26rpx;
  text-align: center;
  border: none;
}

.action-btn.primary {
  background-color: #1890ff;
  color: #fff;
}

.action-btn.secondary {
  background-color: #fff;
  color: #666;
  border: 2rpx solid #d9d9d9;
}

.action-btn.danger {
  background-color: #fff;
  color: #ff4d4f;
  border: 2rpx solid #ff4d4f;
}

.action-btn-text {
  font-size: 26rpx;
}

/* 底部提示 */
.footer-tips {
  margin-top: 30rpx;
  padding: 20rpx 30rpx;
  background-color: #fff7e6;
  border-radius: 12rpx;
  border-left: 4rpx solid #faad14;
}

.tip-text {
  font-size: 24rpx;
  color: #fa8c16;
  line-height: 1.6;
}
</style>
