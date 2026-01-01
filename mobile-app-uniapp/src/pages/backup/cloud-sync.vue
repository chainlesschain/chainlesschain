<template>
  <view class="cloud-sync-page">
    <!-- 云同步状态 -->
    <view class="status-card" v-if="syncConfig && syncConfig.enabled">
      <view class="status-header">
        <text class="status-icon">☁️</text>
        <view class="status-info">
          <text class="status-title">云同步已启用</text>
          <text class="status-desc">{{ getProviderName(syncConfig.type) }}</text>
        </view>
        <view class="status-indicator active"></view>
      </view>

      <view class="status-stats">
        <view class="stat-item">
          <text class="stat-value">{{ syncStatus.totalBackups }}</text>
          <text class="stat-label">本地备份</text>
        </view>
        <view class="stat-item">
          <text class="stat-value">{{ syncStatus.uploadedBackups }}</text>
          <text class="stat-label">已上传</text>
        </view>
        <view class="stat-item">
          <text class="stat-value">{{ syncStatus.notUploadedBackups }}</text>
          <text class="stat-label">未上传</text>
        </view>
      </view>

      <view class="last-sync" v-if="syncStatus.lastSyncTime">
        <text class="last-sync-label">最后同步：</text>
        <text class="last-sync-time">{{ formatTime(syncStatus.lastSyncTime) }}</text>
      </view>
    </view>

    <!-- 快捷操作 -->
    <view class="quick-actions" v-if="syncConfig && syncConfig.enabled">
      <view class="action-btn" @click="syncToCloud">
        <text class="action-icon">⬆️</text>
        <text class="action-text">上传到云端</text>
      </view>
      <view class="action-btn" @click="syncFromCloud">
        <text class="action-icon">⬇️</text>
        <text class="action-text">从云端下载</text>
      </view>
      <view class="action-btn" @click="syncBidirectional">
        <text class="action-icon">🔄</text>
        <text class="action-text">双向同步</text>
      </view>
    </view>

    <!-- 云存储配置 -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">云存储设置</text>
      </view>

      <!-- 启用云同步 -->
      <view class="setting-item">
        <view class="setting-info">
          <text class="setting-label">启用云同步</text>
          <text class="setting-desc">自动同步备份到云端</text>
        </view>
        <switch :checked="syncConfig && syncConfig.enabled" @change="toggleCloudSync" />
      </view>

      <!-- 自动同步 -->
      <view class="setting-item" v-if="syncConfig && syncConfig.enabled">
        <view class="setting-info">
          <text class="setting-label">自动云同步</text>
          <text class="setting-desc">应用启动时自动同步（每6小时一次）</text>
        </view>
        <switch :checked="autoCloudSync" @change="toggleAutoCloudSync" />
      </view>

      <!-- 选择云服务提供商 -->
      <view class="setting-item">
        <view class="setting-info">
          <text class="setting-label">云服务提供商</text>
          <text class="setting-desc">{{ getProviderName(selectedProvider) }}</text>
        </view>
        <picker
          mode="selector"
          :range="providers"
          range-key="name"
          :value="selectedProviderIndex"
          @change="onProviderChange"
        >
          <view class="picker-value">
            <text>选择</text>
          </view>
        </picker>
      </view>
    </view>

    <!-- 配置表单 -->
    <view class="section" v-if="selectedProvider">
      <view class="section-header">
        <text class="section-title">连接配置</text>
      </view>

      <view class="form-container">
        <view class="form-item" v-for="field in currentProviderFields" :key="field.key">
          <text class="form-label">{{ field.label }}</text>
          <input
            class="form-input"
            :type="field.type"
            v-model="formData[field.key]"
            :placeholder="field.placeholder"
          />
        </view>

        <view class="form-actions">
          <button class="test-btn" @click="testConnection" :disabled="testing">
            <text>{{ testing ? '测试中...' : '测试连接' }}</text>
          </button>
          <button class="save-btn" @click="saveConfig" :disabled="saving">
            <text>{{ saving ? '保存中...' : '保存配置' }}</text>
          </button>
        </view>
      </view>
    </view>

    <!-- 云端备份列表 -->
    <view class="section" v-if="syncConfig && syncConfig.enabled">
      <view class="section-header">
        <text class="section-title">云端备份</text>
        <text class="section-count">({{ cloudBackups.length }})</text>
        <view class="header-actions">
          <text class="refresh-btn" @click="loadCloudBackups">🔄</text>
        </view>
      </view>

      <view class="loading" v-if="loadingCloud">
        <text>加载中...</text>
      </view>

      <view class="empty" v-else-if="cloudBackups.length === 0">
        <text class="empty-icon">☁️</text>
        <text class="empty-text">云端暂无备份</text>
      </view>

      <view class="backup-list" v-else>
        <view
          class="backup-item"
          v-for="item in cloudBackups"
          :key="item.id"
        >
          <view class="backup-info">
            <view class="backup-header">
              <text class="backup-icon">☁️</text>
              <view class="backup-details">
                <text class="backup-time">{{ formatTime(item.timestamp) }}</text>
                <text class="backup-size">{{ formatSize(item.size) }}</text>
              </view>
            </view>
          </view>

          <view class="backup-actions">
            <view class="action-btn-small restore" @click="restoreFromCloud(item)">
              <text>恢复</text>
            </view>
            <view class="action-btn-small delete" @click="confirmDeleteCloud(item)">
              <text>删除</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 说明 -->
    <view class="section info-section">
      <view class="info-item">
        <text class="info-icon">💡</text>
        <text class="info-text">支持 WebDAV 协议，可使用坚果云、NextCloud 等服务</text>
      </view>
      <view class="info-item">
        <text class="info-icon">🔒</text>
        <text class="info-text">建议启用备份加密以保护您的数据安全</text>
      </view>
      <view class="info-item">
        <text class="info-icon">🔄</text>
        <text class="info-text">云同步会自动上传新创建的备份</text>
      </view>
    </view>
  </view>
</template>

<script>
import { cloudSync } from '@/services/cloudSync'
import { CloudStorageFactory } from '@/services/cloud/cloudStorage'
import { backup } from '@/services/backup'

export default {
  data() {
    return {
      syncConfig: null,
      syncStatus: {
        totalBackups: 0,
        uploadedBackups: 0,
        notUploadedBackups: 0,
        lastSyncTime: null
      },
      providers: [],
      selectedProvider: '',
      selectedProviderIndex: 0,
      formData: {},
      testing: false,
      saving: false,
      cloudBackups: [],
      loadingCloud: false,
      autoCloudSync: false
    }
  },
  computed: {
    currentProviderFields() {
      if (!this.selectedProvider) return []
      const provider = this.providers.find(p => p.type === this.selectedProvider)
      return provider ? provider.configFields : []
    }
  },
  onLoad() {
    this.loadProviders()
    this.loadConfig()
    this.loadSyncStatus()
  },
  onShow() {
    this.loadSyncStatus()
    if (this.syncConfig && this.syncConfig.enabled) {
      this.loadCloudBackups()
    }
  },
  methods: {
    /**
     * 加载云服务提供商列表
     */
    loadProviders() {
      this.providers = CloudStorageFactory.getSupportedProviders()
    },

    /**
     * 加载配置
     */
    loadConfig() {
      this.syncConfig = cloudSync.getCloudConfig()
      if (this.syncConfig) {
        this.selectedProvider = this.syncConfig.type
        this.selectedProviderIndex = this.providers.findIndex(p => p.type === this.syncConfig.type)
        this.formData = { ...this.syncConfig }
      }

      // 加载自动同步设置
      this.autoCloudSync = uni.getStorageSync('auto_cloud_sync') === 'true'
    },

    /**
     * 加载同步状态
     */
    loadSyncStatus() {
      this.syncStatus = cloudSync.getSyncStatus()
    },

    /**
     * 加载云端备份列表
     */
    async loadCloudBackups() {
      this.loadingCloud = true
      try {
        this.cloudBackups = await cloudSync.listCloudBackups()
      } catch (error) {
        console.error('加载云端备份失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loadingCloud = false
      }
    },

    /**
     * 切换云同步
     */
    async toggleCloudSync(e) {
      const enabled = e.detail.value

      if (enabled && !this.syncConfig) {
        uni.showToast({
          title: '请先配置云存储',
          icon: 'none'
        })
        return
      }

      try {
        const config = { ...this.syncConfig, enabled }
        cloudSync.saveCloudConfig(config)
        this.syncConfig = config

        uni.showToast({
          title: enabled ? '已启用云同步' : '已关闭云同步',
          icon: 'success'
        })

        if (enabled) {
          this.loadCloudBackups()
        }
      } catch (error) {
        console.error('切换云同步失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    /**
     * 切换自动云同步
     */
    toggleAutoCloudSync(e) {
      this.autoCloudSync = e.detail.value
      uni.setStorageSync('auto_cloud_sync', String(this.autoCloudSync))

      uni.showToast({
        title: this.autoCloudSync ? '已启用自动云同步' : '已关闭自动云同步',
        icon: 'success'
      })
    },

    /**
     * 选择提供商
     */
    onProviderChange(e) {
      const index = e.detail.value
      this.selectedProviderIndex = index
      this.selectedProvider = this.providers[index].type

      // 初始化表单数据
      this.formData = { type: this.selectedProvider }

      // 设置默认值
      const provider = this.providers[index]
      provider.configFields.forEach(field => {
        if (field.default) {
          this.formData[field.key] = field.default
        }
      })
    },

    /**
     * 测试连接
     */
    async testConnection() {
      if (this.testing) return

      // 验证必填字段
      const provider = this.providers.find(p => p.type === this.selectedProvider)
      if (!provider) return

      for (const field of provider.configFields) {
        if (!this.formData[field.key]) {
          uni.showToast({
            title: `请填写${field.label}`,
            icon: 'none'
          })
          return
        }
      }

      this.testing = true

      try {
        const config = {
          type: this.selectedProvider,
          ...this.formData
        }

        const success = await cloudSync.testConnection(config)

        if (success) {
          uni.showToast({
            title: '连接成功',
            icon: 'success'
          })
        } else {
          uni.showToast({
            title: '连接失败，请检查配置',
            icon: 'none',
            duration: 3000
          })
        }
      } catch (error) {
        console.error('测试连接失败:', error)
        uni.showToast({
          title: '连接失败: ' + error.message,
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.testing = false
      }
    },

    /**
     * 保存配置
     */
    async saveConfig() {
      if (this.saving) return

      // 验证必填字段
      const provider = this.providers.find(p => p.type === this.selectedProvider)
      if (!provider) return

      for (const field of provider.configFields) {
        if (!this.formData[field.key]) {
          uni.showToast({
            title: `请填写${field.label}`,
            icon: 'none'
          })
          return
        }
      }

      this.saving = true

      try {
        const config = {
          type: this.selectedProvider,
          enabled: false, // 默认不启用，需要用户手动开启
          ...this.formData
        }

        cloudSync.saveCloudConfig(config)
        this.syncConfig = config

        uni.showToast({
          title: '保存成功',
          icon: 'success'
        })

        // 提示用户启用云同步
        setTimeout(() => {
          uni.showModal({
            title: '配置已保存',
            content: '是否立即启用云同步？',
            success: (res) => {
              if (res.confirm) {
                this.syncConfig.enabled = true
                cloudSync.saveCloudConfig(this.syncConfig)
                this.loadSyncStatus()
                this.loadCloudBackups()
              }
            }
          })
        }, 1000)
      } catch (error) {
        console.error('保存配置失败:', error)
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        })
      } finally {
        this.saving = false
      }
    },

    /**
     * 同步到云端
     */
    async syncToCloud() {
      uni.showLoading({ title: '上传中...' })

      try {
        const result = await cloudSync.syncToCloud()

        uni.hideLoading()
        uni.showToast({
          title: `已上传 ${result.uploaded} 个备份`,
          icon: 'success'
        })

        this.loadSyncStatus()
        this.loadCloudBackups()
      } catch (error) {
        uni.hideLoading()
        console.error('上传失败:', error)
        uni.showToast({
          title: '上传失败: ' + error.message,
          icon: 'none',
          duration: 3000
        })
      }
    },

    /**
     * 从云端同步
     */
    async syncFromCloud() {
      uni.showLoading({ title: '下载中...' })

      try {
        const result = await cloudSync.syncFromCloud()

        uni.hideLoading()
        uni.showToast({
          title: `已下载 ${result.downloaded} 个备份`,
          icon: 'success'
        })

        this.loadSyncStatus()
      } catch (error) {
        uni.hideLoading()
        console.error('下载失败:', error)
        uni.showToast({
          title: '下载失败: ' + error.message,
          icon: 'none',
          duration: 3000
        })
      }
    },

    /**
     * 双向同步
     */
    async syncBidirectional() {
      uni.showLoading({ title: '同步中...' })

      try {
        const result = await cloudSync.syncBidirectional()

        uni.hideLoading()
        uni.showModal({
          title: '同步完成',
          content: `上传: ${result.uploaded} 个\n下载: ${result.downloaded} 个\n失败: ${result.failed} 个`,
          showCancel: false
        })

        this.loadSyncStatus()
        this.loadCloudBackups()
      } catch (error) {
        uni.hideLoading()
        console.error('同步失败:', error)
        uni.showToast({
          title: '同步失败: ' + error.message,
          icon: 'none',
          duration: 3000
        })
      }
    },

    /**
     * 从云端恢复
     */
    async restoreFromCloud(item) {
      uni.showModal({
        title: '恢复备份',
        content: '确定要从云端恢复此备份吗？',
        success: async (res) => {
          if (res.confirm) {
            uni.showLoading({ title: '恢复中...' })

            try {
              const stats = await cloudSync.restoreFromCloud(item.fileName, {
                encrypted: false,
                merge: false
              })

              uni.hideLoading()

              const message = `恢复完成！\n知识: ${stats.knowledge}\n好友: ${stats.friends}\n消息: ${stats.messages}\n动态: ${stats.posts}`

              uni.showModal({
                title: '恢复成功',
                content: message,
                showCancel: false,
                success: () => {
                  setTimeout(() => {
                    uni.reLaunch({
                      url: '/pages/knowledge/list/list'
                    })
                  }, 1000)
                }
              })
            } catch (error) {
              uni.hideLoading()
              console.error('恢复失败:', error)
              uni.showToast({
                title: '恢复失败: ' + error.message,
                icon: 'none',
                duration: 3000
              })
            }
          }
        }
      })
    },

    /**
     * 确认删除云端备份
     */
    confirmDeleteCloud(item) {
      uni.showModal({
        title: '删除云端备份',
        content: '确定要删除此云端备份吗？',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            await this.deleteCloudBackup(item)
          }
        }
      })
    },

    /**
     * 删除云端备份
     */
    async deleteCloudBackup(item) {
      try {
        await cloudSync.deleteCloudBackup(item.fileName)

        uni.showToast({
          title: '已删除',
          icon: 'success'
        })

        this.loadCloudBackups()
      } catch (error) {
        console.error('删除失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    /**
     * 获取提供商名称
     */
    getProviderName(type) {
      const provider = this.providers.find(p => p.type === type)
      return provider ? provider.name : '未配置'
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      if (!timestamp) return '从未'

      const date = new Date(timestamp)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day} ${hour}:${minute}`
    },

    /**
     * 格式化大小
     */
    formatSize(bytes) {
      return backup.formatSize(bytes)
    }
  }
}
</script>

<style lang="scss" scoped>
.cloud-sync-page {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 100rpx;
}

.status-card {
  margin: 24rpx;
  padding: 32rpx;
  background-color: var(--bg-card);
  border-radius: 16rpx;
  box-shadow: var(--shadow-sm);

  .status-header {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 24rpx;

    .status-icon {
      font-size: 48rpx;
    }

    .status-info {
      flex: 1;

      .status-title {
        display: block;
        font-size: 32rpx;
        font-weight: bold;
        color: var(--text-primary);
        margin-bottom: 4rpx;
      }

      .status-desc {
        display: block;
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }

    .status-indicator {
      width: 16rpx;
      height: 16rpx;
      border-radius: 50%;
      background-color: var(--text-tertiary);

      &.active {
        background-color: var(--color-success);
        animation: pulse 2s ease-in-out infinite;
      }
    }
  }

  .status-stats {
    display: flex;
    justify-content: space-around;
    padding: 24rpx 0;
    border-top: 1rpx solid var(--border-light);
    border-bottom: 1rpx solid var(--border-light);

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8rpx;

      .stat-value {
        font-size: 40rpx;
        font-weight: bold;
        color: var(--color-primary);
      }

      .stat-label {
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }
  }

  .last-sync {
    margin-top: 16rpx;
    text-align: center;
    font-size: 24rpx;
    color: var(--text-tertiary);

    .last-sync-time {
      color: var(--text-secondary);
    }
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.quick-actions {
  padding: 0 24rpx 24rpx;
  display: flex;
  gap: 16rpx;

  .action-btn {
    flex: 1;
    background-color: var(--bg-card);
    border-radius: 12rpx;
    padding: 24rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8rpx;
    box-shadow: var(--shadow-sm);

    .action-icon {
      font-size: 40rpx;
    }

    .action-text {
      font-size: 24rpx;
      color: var(--text-secondary);
    }
  }
}

.section {
  background-color: var(--bg-card);
  margin: 24rpx;
  border-radius: 16rpx;
  padding: 32rpx;
  box-shadow: var(--shadow-sm);

  .section-header {
    display: flex;
    align-items: center;
    margin-bottom: 24rpx;

    .section-title {
      font-size: 32rpx;
      font-weight: bold;
      color: var(--text-primary);
    }

    .section-count {
      margin-left: 8rpx;
      font-size: 24rpx;
      color: var(--text-tertiary);
    }

    .header-actions {
      margin-left: auto;

      .refresh-btn {
        font-size: 32rpx;
        cursor: pointer;
      }
    }
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24rpx 0;
    border-bottom: 1rpx solid var(--border-light);

    &:last-child {
      border-bottom: none;
    }

    .setting-info {
      flex: 1;
      margin-right: 24rpx;

      .setting-label {
        display: block;
        font-size: 28rpx;
        color: var(--text-primary);
        margin-bottom: 8rpx;
      }

      .setting-desc {
        display: block;
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }

    .picker-value {
      padding: 12rpx 24rpx;
      background-color: var(--bg-input);
      border-radius: 8rpx;
      font-size: 26rpx;
      color: var(--color-primary);
    }

    switch {
      transform: scale(0.9);
    }
  }
}

.form-container {
  .form-item {
    margin-bottom: 24rpx;

    .form-label {
      display: block;
      font-size: 28rpx;
      color: var(--text-secondary);
      margin-bottom: 12rpx;
    }

    .form-input {
      width: 100%;
      height: 80rpx;
      padding: 0 24rpx;
      background-color: var(--bg-input);
      color: var(--text-primary);
      border-radius: 8rpx;
      font-size: 28rpx;
    }
  }

  .form-actions {
    display: flex;
    gap: 16rpx;
    margin-top: 32rpx;

    button {
      flex: 1;
      height: 88rpx;
      border-radius: 44rpx;
      font-size: 30rpx;
      font-weight: 500;
      border: none;

      &::after {
        border: none;
      }
    }

    .test-btn {
      background-color: var(--bg-input);
      color: var(--text-secondary);

      &[disabled] {
        opacity: 0.5;
      }
    }

    .save-btn {
      background-color: var(--color-primary);
      color: var(--text-inverse);

      &[disabled] {
        opacity: 0.5;
      }
    }
  }
}

.loading, .empty {
  text-align: center;
  padding: 100rpx 40rpx;
  color: var(--text-tertiary);
}

.empty {
  .empty-icon {
    display: block;
    font-size: 120rpx;
    margin-bottom: 20rpx;
  }

  .empty-text {
    display: block;
    font-size: 28rpx;
    color: var(--text-secondary);
  }
}

.backup-list {
  .backup-item {
    padding: 24rpx 0;
    border-bottom: 1rpx solid var(--border-light);

    &:last-child {
      border-bottom: none;
    }

    .backup-info {
      margin-bottom: 16rpx;

      .backup-header {
        display: flex;
        align-items: center;
        gap: 16rpx;

        .backup-icon {
          font-size: 40rpx;
        }

        .backup-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4rpx;

          .backup-time {
            font-size: 28rpx;
            color: var(--text-primary);
            font-weight: 500;
          }

          .backup-size {
            font-size: 24rpx;
            color: var(--text-tertiary);
          }
        }
      }
    }

    .backup-actions {
      display: flex;
      gap: 16rpx;

      .action-btn-small {
        flex: 1;
        height: 64rpx;
        border-radius: 32rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26rpx;

        &.restore {
          background-color: var(--bg-info-light);
          color: var(--color-info);
        }

        &.delete {
          background-color: var(--bg-error-light);
          color: var(--color-error);
        }
      }
    }
  }
}

.info-section {
  .info-item {
    display: flex;
    align-items: flex-start;
    gap: 16rpx;
    padding: 20rpx 0;
    border-bottom: 1rpx solid var(--border-light);

    &:last-child {
      border-bottom: none;
    }

    .info-icon {
      font-size: 32rpx;
      margin-top: 4rpx;
    }

    .info-text {
      flex: 1;
      font-size: 26rpx;
      color: var(--text-secondary);
      line-height: 1.6;
    }
  }
}
</style>
