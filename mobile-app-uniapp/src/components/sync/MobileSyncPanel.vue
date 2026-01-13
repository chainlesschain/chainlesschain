<template>
  <view class="mobile-sync-panel">
    <!-- 同步状态卡片 -->
    <view class="sync-status-card">
      <view class="status-header">
        <text class="status-title">移动端同步</text>
        <view :class="['status-indicator', syncStatus]">
          <text class="status-text">{{ statusText }}</text>
        </view>
      </view>

      <!-- 桌面端连接状态 -->
      <view class="desktop-connection" v-if="desktopDevice">
        <view class="connection-info">
          <text class="connection-label">桌面端设备</text>
          <text class="connection-value">{{ desktopDevice.deviceInfo.name }}</text>
        </view>
        <view class="connection-info">
          <text class="connection-label">连接状态</text>
          <text :class="['connection-status', desktopDevice.status]">
            {{ desktopDevice.status === 'online' ? '已连接' : '离线' }}
          </text>
        </view>
      </view>

      <!-- 未连接提示 -->
      <view class="no-connection" v-else>
        <text class="no-connection-text">未连接到桌面端</text>
        <button class="connect-btn" @click="connectToDesktop">连接桌面端</button>
      </view>
    </view>

    <!-- 同步进度 -->
    <view class="sync-progress" v-if="isSyncing">
      <view class="progress-header">
        <text class="progress-title">正在同步...</text>
        <text class="progress-percent">{{ syncProgressPercent }}%</text>
      </view>

      <view class="progress-bar">
        <view class="progress-fill" :style="{ width: syncProgressPercent + '%' }"></view>
      </view>

      <view class="progress-details">
        <view class="progress-item" v-for="(progress, type) in syncProgress" :key="type">
          <text class="progress-label">{{ getSyncTypeLabel(type) }}</text>
          <text class="progress-value">{{ Math.round(progress * 100) }}%</text>
        </view>
      </view>
    </view>

    <!-- 同步统计 -->
    <view class="sync-stats">
      <text class="stats-title">同步统计</text>

      <view class="stats-grid">
        <view class="stat-item">
          <text class="stat-value">{{ stats.knowledgeReceived }}</text>
          <text class="stat-label">知识库接收</text>
        </view>

        <view class="stat-item">
          <text class="stat-value">{{ stats.contactsReceived }}</text>
          <text class="stat-label">联系人接收</text>
        </view>

        <view class="stat-item">
          <text class="stat-value">{{ stats.groupChatsReceived }}</text>
          <text class="stat-label">群聊接收</text>
        </view>

        <view class="stat-item">
          <text class="stat-value">{{ stats.messagesReceived }}</text>
          <text class="stat-label">消息接收</text>
        </view>

        <view class="stat-item">
          <text class="stat-value">{{ stats.knowledgeUploaded }}</text>
          <text class="stat-label">知识库上传</text>
        </view>

        <view class="stat-item">
          <text class="stat-value">{{ stats.contactsUploaded }}</text>
          <text class="stat-label">联系人上传</text>
        </view>

        <view class="stat-item">
          <text class="stat-value">{{ stats.groupChatsUploaded }}</text>
          <text class="stat-label">群聊上传</text>
        </view>

        <view class="stat-item">
          <text class="stat-value">{{ stats.messagesUploaded }}</text>
          <text class="stat-label">消息上传</text>
        </view>
      </view>
    </view>

    <!-- 同步设置 -->
    <view class="sync-settings">
      <text class="settings-title">同步设置</text>

      <view class="setting-item">
        <text class="setting-label">自动同步</text>
        <switch :checked="autoSyncEnabled" @change="toggleAutoSync" />
      </view>

      <view class="setting-item">
        <text class="setting-label">同步知识库</text>
        <switch :checked="syncKnowledge" @change="toggleSyncKnowledge" />
      </view>

      <view class="setting-item">
        <text class="setting-label">同步联系人</text>
        <switch :checked="syncContacts" @change="toggleSyncContacts" />
      </view>

      <view class="setting-item">
        <text class="setting-label">同步群聊</text>
        <switch :checked="syncGroupChats" @change="toggleSyncGroupChats" />
      </view>

      <view class="setting-item">
        <text class="setting-label">同步消息</text>
        <switch :checked="syncMessages" @change="toggleSyncMessages" />
      </view>
    </view>

    <!-- 操作按钮 -->
    <view class="action-buttons">
      <button class="action-btn primary" @click="manualSync" :disabled="isSyncing || !desktopDevice">
        {{ isSyncing ? '同步中...' : '立即同步' }}
      </button>

      <button class="action-btn" @click="uploadChanges" :disabled="isSyncing || !desktopDevice">
        上传本地变更
      </button>

      <button class="action-btn danger" @click="disconnect" v-if="desktopDevice">
        断开连接
      </button>
    </view>

    <!-- 最后同步时间 -->
    <view class="last-sync-time" v-if="lastSyncTime">
      <text class="last-sync-label">最后同步时间：</text>
      <text class="last-sync-value">{{ formatTime(lastSyncTime) }}</text>
    </view>
  </view>
</template>

<script>
import { getMobileSyncClient } from '@/services/sync/mobile-sync-client'

export default {
  name: 'MobileSyncPanel',

  data() {
    return {
      syncClient: null,
      desktopDevice: null,
      isSyncing: false,
      syncProgress: {},
      stats: {
        knowledgeReceived: 0,
        contactsReceived: 0,
        groupChatsReceived: 0,
        messagesReceived: 0,
        knowledgeUploaded: 0,
        contactsUploaded: 0,
        groupChatsUploaded: 0,
        messagesUploaded: 0
      },
      autoSyncEnabled: true,
      syncKnowledge: true,
      syncContacts: true,
      syncGroupChats: true,
      syncMessages: true,
      lastSyncTime: null
    }
  },

  computed: {
    syncStatus() {
      if (this.isSyncing) return 'syncing'
      if (!this.desktopDevice) return 'disconnected'
      if (this.desktopDevice.status === 'online') return 'connected'
      return 'offline'
    },

    statusText() {
      switch (this.syncStatus) {
        case 'syncing': return '同步中'
        case 'connected': return '已连接'
        case 'offline': return '离线'
        case 'disconnected': return '未连接'
        default: return '未知'
      }
    },

    syncProgressPercent() {
      const values = Object.values(this.syncProgress)
      if (values.length === 0) return 0

      const sum = values.reduce((acc, val) => acc + val, 0)
      return Math.round((sum / values.length) * 100)
    }
  },

  mounted() {
    this.initSyncClient()
  },

  beforeUnmount() {
    if (this.syncClient) {
      this.syncClient.cleanup()
    }
  },

  methods: {
    /**
     * 初始化同步客户端
     */
    async initSyncClient() {
      try {
        this.syncClient = getMobileSyncClient({
          enableAutoSync: this.autoSyncEnabled,
          syncKnowledge: this.syncKnowledge,
          syncContacts: this.syncContacts,
          syncGroupChats: this.syncGroupChats,
          syncMessages: this.syncMessages
        })

        await this.syncClient.initialize()

        // 注册事件监听器
        this.registerEventListeners()

        // 加载统计信息
        this.loadStats()

        // 加载同步时间
        this.loadSyncTime()

      } catch (error) {
        console.error('初始化同步客户端失败:', error)
        uni.showToast({
          title: '初始化失败',
          icon: 'error'
        })
      }
    },

    /**
     * 注册事件监听器
     */
    registerEventListeners() {
      // 桌面端连接
      this.syncClient.on('desktop:connected', (data) => {
        this.desktopDevice = data
        uni.showToast({
          title: '已连接到桌面端',
          icon: 'success'
        })
      })

      // 桌面端断开
      this.syncClient.on('desktop:disconnected', () => {
        this.desktopDevice = null
        uni.showToast({
          title: '已断开连接',
          icon: 'none'
        })
      })

      // 同步进度
      this.syncClient.on('sync:progress', (data) => {
        this.syncProgress = { ...this.syncProgress, [data.type]: data.progress }
      })

      // 知识库接收
      this.syncClient.on('sync:knowledge-received', (data) => {
        this.stats.knowledgeReceived += data.count
        this.lastSyncTime = Date.now()
      })

      // 联系人接收
      this.syncClient.on('sync:contacts-received', (data) => {
        this.stats.contactsReceived += data.count
        this.lastSyncTime = Date.now()
      })

      // 群聊接收
      this.syncClient.on('sync:group-chats-received', (data) => {
        this.stats.groupChatsReceived += data.count
        this.lastSyncTime = Date.now()
      })

      // 消息接收
      this.syncClient.on('sync:messages-received', (data) => {
        this.stats.messagesReceived += data.count
        this.lastSyncTime = Date.now()
      })
    },

    /**
     * 连接到桌面端
     */
    async connectToDesktop() {
      try {
        // 这里应该显示一个对话框让用户输入桌面端的连接信息
        // 简化处理，使用默认值
        uni.showLoading({ title: '连接中...' })

        // TODO: 实现桌面端发现和连接逻辑
        // 这里需要通过扫码或输入连接码的方式获取桌面端信息

        uni.hideLoading()

      } catch (error) {
        console.error('连接桌面端失败:', error)
        uni.hideLoading()
        uni.showToast({
          title: '连接失败',
          icon: 'error'
        })
      }
    },

    /**
     * 手动同步
     */
    async manualSync() {
      try {
        this.isSyncing = true
        this.syncProgress = {}

        await this.syncClient.requestFullSync()

        uni.showToast({
          title: '同步完成',
          icon: 'success'
        })

      } catch (error) {
        console.error('同步失败:', error)
        uni.showToast({
          title: '同步失败',
          icon: 'error'
        })
      } finally {
        this.isSyncing = false
      }
    },

    /**
     * 上传本地变更
     */
    async uploadChanges() {
      try {
        uni.showLoading({ title: '上传中...' })

        await this.syncClient.uploadLocalChanges()

        // 更新统计信息
        const stats = this.syncClient.getStats()
        this.stats.knowledgeUploaded = stats.knowledgeUploaded
        this.stats.contactsUploaded = stats.contactsUploaded
        this.stats.groupChatsUploaded = stats.groupChatsUploaded
        this.stats.messagesUploaded = stats.messagesUploaded

        uni.hideLoading()
        uni.showToast({
          title: '上传完成',
          icon: 'success'
        })

      } catch (error) {
        console.error('上传失败:', error)
        uni.hideLoading()
        uni.showToast({
          title: '上传失败',
          icon: 'error'
        })
      }
    },

    /**
     * 断开连接
     */
    async disconnect() {
      try {
        await this.syncClient.disconnect()
        this.desktopDevice = null

      } catch (error) {
        console.error('断开连接失败:', error)
        uni.showToast({
          title: '断开失败',
          icon: 'error'
        })
      }
    },

    /**
     * 切换自动同步
     */
    toggleAutoSync(e) {
      this.autoSyncEnabled = e.detail.value

      if (this.autoSyncEnabled) {
        this.syncClient.startAutoSync()
      } else {
        this.syncClient.stopAutoSync()
      }

      uni.setStorageSync('auto_sync_enabled', this.autoSyncEnabled)
    },

    /**
     * 切换同步知识库
     */
    toggleSyncKnowledge(e) {
      this.syncKnowledge = e.detail.value
      uni.setStorageSync('sync_knowledge', this.syncKnowledge)
    },

    /**
     * 切换同步联系人
     */
    toggleSyncContacts(e) {
      this.syncContacts = e.detail.value
      uni.setStorageSync('sync_contacts', this.syncContacts)
    },

    /**
     * 切换同步群聊
     */
    toggleSyncGroupChats(e) {
      this.syncGroupChats = e.detail.value
      uni.setStorageSync('sync_group_chats', this.syncGroupChats)
    },

    /**
     * 切换同步消息
     */
    toggleSyncMessages(e) {
      this.syncMessages = e.detail.value
      uni.setStorageSync('sync_messages', this.syncMessages)
    },

    /**
     * 获取同步类型标签
     */
    getSyncTypeLabel(type) {
      const labels = {
        knowledge: '知识库',
        contacts: '联系人',
        groupChats: '群聊',
        messages: '消息'
      }
      return labels[type] || type
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      if (!timestamp) return '-'

      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) {
        return '刚刚'
      } else if (diff < 3600000) {
        return `${Math.floor(diff / 60000)}分钟前`
      } else if (diff < 86400000) {
        return `${Math.floor(diff / 3600000)}小时前`
      } else {
        return date.toLocaleString('zh-CN')
      }
    },

    /**
     * 加载统计信息
     */
    loadStats() {
      if (this.syncClient) {
        const stats = this.syncClient.getStats()
        this.stats = { ...this.stats, ...stats }
      }
    },

    /**
     * 加载同步时间
     */
    loadSyncTime() {
      if (this.syncClient) {
        const syncTime = this.syncClient.lastSyncTime
        if (syncTime.knowledge > 0) {
          this.lastSyncTime = Math.max(
            syncTime.knowledge,
            syncTime.contacts,
            syncTime.groupChats,
            syncTime.messages
          )
        }
      }
    }
  }
}
</script>

<style scoped>
.mobile-sync-panel {
  padding: 20rpx;
  background-color: #f5f5f5;
  min-height: 100vh;
}

.sync-status-card {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30rpx;
}

.status-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

.status-indicator {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  font-size: 24rpx;
}

.status-indicator.connected {
  background-color: #e8f5e9;
  color: #4caf50;
}

.status-indicator.syncing {
  background-color: #e3f2fd;
  color: #2196f3;
}

.status-indicator.offline {
  background-color: #fff3e0;
  color: #ff9800;
}

.status-indicator.disconnected {
  background-color: #fce4ec;
  color: #e91e63;
}

.desktop-connection {
  border-top: 1rpx solid #eee;
  padding-top: 20rpx;
}

.connection-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15rpx;
}

.connection-label {
  font-size: 28rpx;
  color: #666;
}

.connection-value {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.connection-status {
  font-size: 28rpx;
  font-weight: 500;
}

.connection-status.online {
  color: #4caf50;
}

.connection-status.offline {
  color: #ff9800;
}

.no-connection {
  text-align: center;
  padding: 40rpx 0;
}

.no-connection-text {
  font-size: 28rpx;
  color: #999;
  margin-bottom: 30rpx;
  display: block;
}

.connect-btn {
  background-color: #2196f3;
  color: #fff;
  border: none;
  border-radius: 8rpx;
  padding: 20rpx 40rpx;
  font-size: 28rpx;
}

.sync-progress {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.progress-title {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.progress-percent {
  font-size: 32rpx;
  color: #2196f3;
  font-weight: bold;
}

.progress-bar {
  height: 12rpx;
  background-color: #e0e0e0;
  border-radius: 6rpx;
  overflow: hidden;
  margin-bottom: 30rpx;
}

.progress-fill {
  height: 100%;
  background-color: #2196f3;
  transition: width 0.3s ease;
}

.progress-details {
  display: flex;
  flex-direction: column;
  gap: 15rpx;
}

.progress-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-label {
  font-size: 26rpx;
  color: #666;
}

.progress-value {
  font-size: 26rpx;
  color: #2196f3;
  font-weight: 500;
}

.sync-stats {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.stats-title {
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 30rpx;
  display: block;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 30rpx;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 40rpx;
  font-weight: bold;
  color: #2196f3;
  display: block;
  margin-bottom: 10rpx;
}

.stat-label {
  font-size: 24rpx;
  color: #999;
  display: block;
}

.sync-settings {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.settings-title {
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 30rpx;
  display: block;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  font-size: 28rpx;
  color: #333;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-bottom: 20rpx;
}

.action-btn {
  background-color: #fff;
  color: #333;
  border: 1rpx solid #ddd;
  border-radius: 8rpx;
  padding: 25rpx;
  font-size: 28rpx;
  text-align: center;
}

.action-btn.primary {
  background-color: #2196f3;
  color: #fff;
  border: none;
}

.action-btn.danger {
  background-color: #f44336;
  color: #fff;
  border: none;
}

.action-btn:disabled {
  opacity: 0.5;
}

.last-sync-time {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  text-align: center;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.last-sync-label {
  font-size: 24rpx;
  color: #999;
}

.last-sync-value {
  font-size: 24rpx;
  color: #666;
  font-weight: 500;
}
</style>
