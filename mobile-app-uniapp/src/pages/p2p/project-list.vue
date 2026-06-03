<template>
  <view class="container">
    <!-- PC设备选择 -->
    <view class="device-selector">
      <picker :value="selectedDeviceIndex" :range="devices" range-key="deviceName" @change="handleDeviceChange">
        <view class="selector">
          <text class="selector-text">{{ selectedDevice ? selectedDevice.deviceName : '请选择PC设备' }}</text>
          <text class="selector-arrow">▼</text>
        </view>
      </picker>
    </view>

    <!-- 加载状态 -->
    <view v-if="loading && !projects.length" class="loading-container">
      <text class="loading-text">正在加载项目列表...</text>
    </view>

    <!-- 空状态 -->
    <view v-else-if="!loading && !projects.length" class="empty-container">
      <text class="empty-icon">📂</text>
      <text class="empty-text">暂无项目</text>
      <text class="empty-hint">{{ selectedDevice ? '该PC设备上没有项目' : '请先选择PC设备' }}</text>
    </view>

    <!-- 项目列表 -->
    <scroll-view
      v-else
      class="project-list"
      scroll-y
      @scrolltolower="loadMore"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="handleRefresh"
    >
      <view
        v-for="project in projects"
        :key="project.id"
        class="project-card"
        @tap="viewProjectDetail(project)"
      >
        <!-- 项目图标 -->
        <view class="project-icon">
          <text class="icon-text">{{ getProjectIcon(project.name) }}</text>
        </view>

        <!-- 项目信息 -->
        <view class="project-info">
          <view class="project-header">
            <text class="project-name">{{ project.name }}</text>
            <view v-if="project.git_url" class="git-badge">
              <text class="git-badge-text">Git</text>
            </view>
          </view>

          <text v-if="project.description" class="project-description">{{ project.description }}</text>

          <view class="project-meta">
            <view class="meta-item">
              <text class="meta-icon">📄</text>
              <text class="meta-text">{{ project.fileCount || 0 }} 个文件</text>
            </view>
            <view class="meta-item">
              <text class="meta-icon">🕒</text>
              <text class="meta-text">{{ formatTime(project.updated_at) }}</text>
            </view>
          </view>

          <!-- Git信息 -->
          <view v-if="project.last_commit_message" class="commit-info">
            <text class="commit-icon">🔖</text>
            <text class="commit-message">{{ project.last_commit_message }}</text>
          </view>
        </view>

        <!-- 箭头 -->
        <view class="arrow">
          <text class="arrow-icon">›</text>
        </view>
      </view>

      <!-- 加载更多 -->
      <view v-if="hasMore" class="load-more">
        <text class="load-more-text">{{ loading ? '加载中...' : '上拉加载更多' }}</text>
      </view>

      <!-- 无更多数据 -->
      <view v-else-if="projects.length > 0" class="no-more">
        <text class="no-more-text">没有更多项目了</text>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import projectService from '@/services/p2p/project-service.js'
import p2pManager from '@/services/p2p/p2p-manager.js'

export default {
  data() {
    return {
      // PC设备列表
      devices: [],
      selectedDeviceIndex: 0,
      selectedDevice: null,

      // 项目列表
      projects: [],
      total: 0,
      limit: 20,
      offset: 0,
      hasMore: true,

      // 状态
      loading: false,
      refreshing: false
    }
  },

  onLoad() {
    this.loadDevices()
  },

  methods: {
    /**
     * 加载已配对的PC设备
     */
    loadDevices() {
      try {
        const devicesStr = uni.getStorageSync('paired_devices')
        if (devicesStr) {
          this.devices = JSON.parse(devicesStr)

          // 更新连接状态
          this.devices = this.devices.map(device => ({
            ...device,
            connected: p2pManager.getConnectionState(device.peerId) === 'connected'
          }))

          // 选择第一个已连接的设备
          const connectedDevice = this.devices.find(d => d.connected)
          if (connectedDevice) {
            this.selectedDeviceIndex = this.devices.indexOf(connectedDevice)
            this.selectedDevice = connectedDevice
            this.loadProjects()
          }
        }
      } catch (error) {
        console.error('加载设备列表失败:', error)
      }
    },

    /**
     * 切换PC设备
     */
    handleDeviceChange(e) {
      this.selectedDeviceIndex = e.detail.value
      this.selectedDevice = this.devices[this.selectedDeviceIndex]

      // 重新加载项目列表
      this.projects = []
      this.offset = 0
      this.hasMore = true
      this.loadProjects()
    },

    /**
     * 加载项目列表
     */
    async loadProjects() {
      if (!this.selectedDevice) {
        uni.showToast({
          title: '请先选择PC设备',
          icon: 'none'
        })
        return
      }

      if (!this.selectedDevice.connected) {
        uni.showToast({
          title: 'PC设备未连接',
          icon: 'none'
        })
        return
      }

      if (this.loading || !this.hasMore) {
        return
      }

      this.loading = true

      try {
        const data = await projectService.getProjects(
          this.selectedDevice.peerId,
          this.limit,
          this.offset
        )

        if (this.offset === 0) {
          this.projects = data.projects
        } else {
          this.projects = [...this.projects, ...data.projects]
        }

        this.total = data.total
        this.offset += data.projects.length
        this.hasMore = this.projects.length < this.total

      } catch (error) {
        console.error('加载项目列表失败:', error)
        uni.showToast({
          title: error.message || '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
        this.refreshing = false
      }
    },

    /**
     * 下拉刷新
     */
    async handleRefresh() {
      this.refreshing = true
      this.projects = []
      this.offset = 0
      this.hasMore = true
      await this.loadProjects()
    },

    /**
     * 加载更多
     */
    loadMore() {
      if (!this.loading && this.hasMore) {
        this.loadProjects()
      }
    },

    /**
     * 查看项目详情
     */
    viewProjectDetail(project) {
      uni.navigateTo({
        url: `/pages/p2p/project-detail?projectId=${project.id}&peerId=${this.selectedDevice.peerId}&projectName=${encodeURIComponent(project.name)}`
      })
    },

    /**
     * 获取项目图标（根据项目名称首字母）
     */
    getProjectIcon(name) {
      if (!name) return '📁'

      const firstChar = name.charAt(0).toUpperCase()

      // 根据项目名称判断类型
      if (name.includes('vue') || name.includes('Vue')) return '🟢'
      if (name.includes('react') || name.includes('React')) return '🔵'
      if (name.includes('node') || name.includes('Node')) return '🟩'
      if (name.includes('python') || name.includes('Python')) return '🐍'
      if (name.includes('java') || name.includes('Java')) return '☕'
      if (name.includes('web') || name.includes('Web')) return '🌐'

      return firstChar
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      if (!timestamp) return '未知'

      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour
      const week = 7 * day

      if (diff < minute) {
        return '刚刚'
      } else if (diff < hour) {
        return `${Math.floor(diff / minute)}分钟前`
      } else if (diff < day) {
        return `${Math.floor(diff / hour)}小时前`
      } else if (diff < week) {
        return `${Math.floor(diff / day)}天前`
      } else {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      }
    }
  }
}
</script>

<style scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
}

/* 设备选择器 */
.device-selector {
  background-color: #fff;
  padding: 24rpx 32rpx;
  border-bottom: 1px solid #eee;
}

.selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 24rpx;
  background-color: #f8f9fa;
  border-radius: 12rpx;
}

.selector-text {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.selector-arrow {
  font-size: 24rpx;
  color: #999;
}

/* 加载状态 */
.loading-container {
  padding: 120rpx 0;
  text-align: center;
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
  padding: 120rpx 0;
}

.empty-icon {
  font-size: 120rpx;
  margin-bottom: 24rpx;
}

.empty-text {
  font-size: 32rpx;
  color: #666;
  margin-bottom: 12rpx;
}

.empty-hint {
  font-size: 26rpx;
  color: #999;
}

/* 项目列表 */
.project-list {
  height: calc(100vh - 120rpx);
}

.project-card {
  display: flex;
  align-items: center;
  background-color: #fff;
  margin: 24rpx 32rpx;
  padding: 32rpx;
  border-radius: 16rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
  transition: all 0.3s;
}

.project-card:active {
  transform: scale(0.98);
  opacity: 0.9;
}

.project-icon {
  width: 96rpx;
  height: 96rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 24rpx;
  flex-shrink: 0;
}

.icon-text {
  font-size: 48rpx;
  font-weight: bold;
  color: #fff;
}

.project-info {
  flex: 1;
  min-width: 0;
}

.project-header {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}

.project-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
  margin-right: 12rpx;
}

.git-badge {
  padding: 4rpx 12rpx;
  background-color: #f0f0f0;
  border-radius: 6rpx;
}

.git-badge-text {
  font-size: 20rpx;
  color: #666;
}

.project-description {
  font-size: 26rpx;
  color: #666;
  margin-bottom: 16rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-meta {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}

.meta-item {
  display: flex;
  align-items: center;
  margin-right: 32rpx;
}

.meta-icon {
  font-size: 24rpx;
  margin-right: 8rpx;
}

.meta-text {
  font-size: 24rpx;
  color: #999;
}

.commit-info {
  display: flex;
  align-items: center;
  padding: 12rpx;
  background-color: #f8f9fa;
  border-radius: 8rpx;
  margin-top: 12rpx;
}

.commit-icon {
  font-size: 24rpx;
  margin-right: 8rpx;
}

.commit-message {
  font-size: 24rpx;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.arrow {
  margin-left: 16rpx;
}

.arrow-icon {
  font-size: 48rpx;
  color: #ddd;
  font-weight: 300;
}

/* 加载更多 */
.load-more {
  padding: 40rpx 0;
  text-align: center;
}

.load-more-text {
  font-size: 26rpx;
  color: #999;
}

.no-more {
  padding: 40rpx 0;
  text-align: center;
}

.no-more-text {
  font-size: 26rpx;
  color: #ccc;
}
</style>
