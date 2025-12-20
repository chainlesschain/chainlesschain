<template>
  <view class="backup-page">
    <!-- 快捷操作 -->
    <view class="quick-actions">
      <view class="action-card" @click="showCreateBackupModal">
        <text class="action-icon">💾</text>
        <text class="action-title">创建备份</text>
        <text class="action-desc">备份所有数据</text>
      </view>

      <view class="action-card" @click="showRestoreBackupModal">
        <text class="action-icon">📥</text>
        <text class="action-title">恢复备份</text>
        <text class="action-desc">从备份恢复数据</text>
      </view>

      <view class="action-card" @click="goToCloudSync">
        <text class="action-icon">☁️</text>
        <text class="action-title">云同步</text>
        <text class="action-desc">{{ cloudSyncStatus }}</text>
      </view>
    </view>

    <!-- 自动备份设置 -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">自动备份</text>
      </view>

      <view class="setting-item">
        <view class="setting-info">
          <text class="setting-label">启用自动备份</text>
          <text class="setting-desc">每天自动创建备份</text>
        </view>
        <switch :checked="autoBackupEnabled" @change="toggleAutoBackup" />
      </view>

      <view class="setting-item" v-if="autoBackupEnabled">
        <view class="setting-info">
          <text class="setting-label">备份加密</text>
          <text class="setting-desc">使用PIN码加密备份文件</text>
        </view>
        <switch :checked="autoBackupEncrypted" @change="toggleAutoBackupEncryption" />
      </view>
    </view>

    <!-- 备份历史 -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">备份历史</text>
        <text class="section-count">({{ backupList.length }})</text>
      </view>

      <view class="loading" v-if="loading">
        <text>加载中...</text>
      </view>

      <view class="empty" v-else-if="backupList.length === 0">
        <text class="empty-icon">📦</text>
        <text class="empty-text">还没有备份</text>
        <button class="create-btn" @click="showCreateBackupModal">
          <text>立即创建</text>
        </button>
      </view>

      <view class="backup-list" v-else>
        <view
          class="backup-item"
          v-for="item in backupList"
          :key="item.id"
        >
          <view class="backup-info">
            <view class="backup-header">
              <text class="backup-icon">{{ item.encrypted ? '🔒' : '📄' }}</text>
              <view class="backup-details">
                <text class="backup-time">{{ formatTime(item.timestamp) }}</text>
                <text class="backup-size">{{ formatSize(item.size) }}</text>
              </view>
            </view>
            <text class="backup-platform">{{ item.platform }}</text>
          </view>

          <view class="backup-actions">
            <view class="action-btn restore" @click="restoreBackup(item)">
              <text>恢复</text>
            </view>
            <view class="action-btn delete" @click="confirmDelete(item)">
              <text>删除</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 创建备份弹窗 -->
    <view class="modal" v-if="showCreateModal" @click="closeCreateModal">
      <view class="modal-content" @click.stop>
        <text class="modal-title">创建备份</text>

        <view class="form-section">
          <view class="switch-item">
            <view class="switch-info">
              <text class="switch-label">加密备份</text>
              <text class="switch-desc">使用PIN码保护备份文件</text>
            </view>
            <switch :checked="createOptions.encrypted" @change="toggleCreateEncryption" />
          </view>

          <view class="form-item" v-if="createOptions.encrypted">
            <text class="form-label">加密密码</text>
            <input
              class="form-input"
              type="password"
              v-model="createOptions.password"
              placeholder="输入加密密码"
              maxlength="20"
            />
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeCreateModal">
            <text>取消</text>
          </button>
          <button
            class="modal-btn confirm"
            @click="executeCreateBackup"
            :disabled="creating || (createOptions.encrypted && !createOptions.password)"
          >
            <text>{{ creating ? '创建中...' : '确认创建' }}</text>
          </button>
        </view>
      </view>
    </view>

    <!-- 恢复备份弹窗 -->
    <view class="modal" v-if="showRestoreModal" @click="closeRestoreModal">
      <view class="modal-content" @click.stop>
        <text class="modal-title">恢复备份</text>

        <view class="form-section">
          <view class="form-item">
            <text class="form-label">选择备份</text>
            <picker
              mode="selector"
              :range="backupList"
              range-key="fileName"
              @change="onBackupSelect"
            >
              <view class="picker-input">
                <text v-if="restoreOptions.selectedBackup">
                  {{ formatTime(restoreOptions.selectedBackup.timestamp) }}
                </text>
                <text v-else class="placeholder">请选择要恢复的备份</text>
              </view>
            </picker>
          </view>

          <view class="form-item" v-if="restoreOptions.selectedBackup && restoreOptions.selectedBackup.encrypted">
            <text class="form-label">解密密码</text>
            <input
              class="form-input"
              type="password"
              v-model="restoreOptions.password"
              placeholder="输入解密密码"
            />
          </view>

          <view class="switch-item">
            <view class="switch-info">
              <text class="switch-label">合并数据</text>
              <text class="switch-desc">保留现有数据并合并备份</text>
            </view>
            <switch :checked="restoreOptions.merge" @change="toggleRestoreMerge" />
          </view>

          <view class="warning" v-if="!restoreOptions.merge">
            <text class="warning-icon">⚠️</text>
            <text class="warning-text">覆盖模式将清空所有现有数据！</text>
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeRestoreModal">
            <text>取消</text>
          </button>
          <button
            class="modal-btn confirm"
            @click="executeRestoreBackup"
            :disabled="restoring || !restoreOptions.selectedBackup"
          >
            <text>{{ restoring ? '恢复中...' : '确认恢复' }}</text>
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { backup } from '@/services/backup'
import { cloudSync } from '@/services/cloudSync'

export default {
  data() {
    return {
      backupList: [],
      loading: false,
      autoBackupEnabled: false,
      autoBackupEncrypted: false,
      showCreateModal: false,
      showRestoreModal: false,
      creating: false,
      restoring: false,
      createOptions: {
        encrypted: false,
        password: ''
      },
      restoreOptions: {
        selectedBackup: null,
        password: '',
        merge: false
      },
      cloudSyncEnabled: false
    }
  },
  computed: {
    cloudSyncStatus() {
      return this.cloudSyncEnabled ? '已启用' : '未启用'
    }
  },
  onLoad() {
    this.loadBackupList()
    this.loadAutoBackupSettings()
    this.loadCloudSyncStatus()
  },
  onShow() {
    this.loadBackupList()
    this.loadCloudSyncStatus()
  },
  methods: {
    /**
     * 加载备份列表
     */
    loadBackupList() {
      this.loading = true
      try {
        this.backupList = backup.getBackupList()
      } catch (error) {
        console.error('加载备份列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载自动备份设置
     */
    loadAutoBackupSettings() {
      try {
        this.autoBackupEnabled = uni.getStorageSync('auto_backup_enabled') === 'true'
        this.autoBackupEncrypted = uni.getStorageSync('auto_backup_encrypted') === 'true'
      } catch (error) {
        console.error('加载自动备份设置失败:', error)
      }
    },

    /**
     * 加载云同步状态
     */
    loadCloudSyncStatus() {
      try {
        const config = cloudSync.getCloudConfig()
        this.cloudSyncEnabled = config && config.enabled
      } catch (error) {
        console.error('加载云同步状态失败:', error)
      }
    },

    /**
     * 跳转到云同步设置
     */
    goToCloudSync() {
      uni.navigateTo({
        url: '/pages/backup/cloud-sync'
      })
    },

    /**
     * 切换自动备份
     */
    toggleAutoBackup(e) {
      this.autoBackupEnabled = e.detail.value
      uni.setStorageSync('auto_backup_enabled', String(this.autoBackupEnabled))

      if (this.autoBackupEnabled) {
        // 设置自动备份任务（实际应用中可使用后台任务）
        this.scheduleAutoBackup()
      }

      uni.showToast({
        title: this.autoBackupEnabled ? '已开启自动备份' : '已关闭自动备份',
        icon: 'success'
      })
    },

    /**
     * 切换自动备份加密
     */
    toggleAutoBackupEncryption(e) {
      this.autoBackupEncrypted = e.detail.value
      uni.setStorageSync('auto_backup_encrypted', String(this.autoBackupEncrypted))
    },

    /**
     * 调度自动备份
     */
    scheduleAutoBackup() {
      // 简单实现：记录上次备份时间，每次打开应用检查
      const lastBackupTime = uni.getStorageSync('last_auto_backup_time') || 0
      const now = Date.now()
      const oneDayMs = 24 * 60 * 60 * 1000

      if (now - lastBackupTime > oneDayMs) {
        this.autoCreateBackup()
      }
    },

    /**
     * 自动创建备份
     */
    async autoCreateBackup() {
      try {
        const options = {
          encrypted: this.autoBackupEncrypted,
          password: this.autoBackupEncrypted ? uni.getStorageSync('user_pin') : ''
        }

        // 如果启用了云同步，创建并上传
        if (this.cloudSyncEnabled) {
          await cloudSync.createAndUploadBackup(options)
          console.log('自动备份已创建并上传到云端')
        } else {
          await backup.createBackup(options)
          console.log('自动备份完成')
        }

        uni.setStorageSync('last_auto_backup_time', Date.now())
      } catch (error) {
        console.error('自动备份失败:', error)
      }
    },

    /**
     * 显示创建备份弹窗
     */
    showCreateBackupModal() {
      this.showCreateModal = true
      this.createOptions = {
        encrypted: false,
        password: ''
      }
    },

    /**
     * 关闭创建备份弹窗
     */
    closeCreateModal() {
      this.showCreateModal = false
    },

    /**
     * 切换创建加密
     */
    toggleCreateEncryption(e) {
      this.createOptions.encrypted = e.detail.value
    },

    /**
     * 执行创建备份
     */
    async executeCreateBackup() {
      if (this.creating) return

      if (this.createOptions.encrypted && !this.createOptions.password) {
        uni.showToast({
          title: '请输入加密密码',
          icon: 'none'
        })
        return
      }

      this.creating = true

      try {
        // 如果启用了云同步，使用云同步服务创建并上传
        if (this.cloudSyncEnabled) {
          const result = await cloudSync.createAndUploadBackup(this.createOptions)

          uni.showToast({
            title: result.uploaded ? '备份已创建并上传' : '备份创建成功',
            icon: 'success'
          })
        } else {
          // 否则只创建本地备份
          await backup.createBackup(this.createOptions)

          uni.showToast({
            title: '备份创建成功',
            icon: 'success'
          })
        }

        this.closeCreateModal()
        this.loadBackupList()
      } catch (error) {
        console.error('创建备份失败:', error)
        uni.showToast({
          title: '创建失败: ' + error.message,
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.creating = false
      }
    },

    /**
     * 显示恢复备份弹窗
     */
    showRestoreBackupModal() {
      if (this.backupList.length === 0) {
        uni.showToast({
          title: '没有可用的备份',
          icon: 'none'
        })
        return
      }

      this.showRestoreModal = true
      this.restoreOptions = {
        selectedBackup: null,
        password: '',
        merge: false
      }
    },

    /**
     * 关闭恢复备份弹窗
     */
    closeRestoreModal() {
      this.showRestoreModal = false
    },

    /**
     * 选择备份
     */
    onBackupSelect(e) {
      const index = e.detail.value
      this.restoreOptions.selectedBackup = this.backupList[index]
    },

    /**
     * 切换恢复合并模式
     */
    toggleRestoreMerge(e) {
      this.restoreOptions.merge = e.detail.value
    },

    /**
     * 执行恢复备份
     */
    async executeRestoreBackup() {
      if (this.restoring) return

      if (!this.restoreOptions.selectedBackup) {
        uni.showToast({
          title: '请选择要恢复的备份',
          icon: 'none'
        })
        return
      }

      if (this.restoreOptions.selectedBackup.encrypted && !this.restoreOptions.password) {
        uni.showToast({
          title: '请输入解密密码',
          icon: 'none'
        })
        return
      }

      // 二次确认
      const confirmText = this.restoreOptions.merge
        ? '确定要合并此备份吗？'
        : '确定要覆盖所有数据吗？此操作不可撤销！'

      uni.showModal({
        title: '确认恢复',
        content: confirmText,
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            await this.doRestore()
          }
        }
      })
    },

    /**
     * 执行恢复
     */
    async doRestore() {
      this.restoring = true

      try {
        // 获取备份数据
        const backupData = backup.getBackupData(this.restoreOptions.selectedBackup.fileName)

        if (!backupData) {
          throw new Error('备份文件不存在')
        }

        // 恢复数据
        const stats = await backup.importData(backupData, {
          encrypted: this.restoreOptions.selectedBackup.encrypted,
          password: this.restoreOptions.password,
          merge: this.restoreOptions.merge
        })

        // 显示恢复统计
        const message = `恢复完成！\n知识: ${stats.knowledge}\n好友: ${stats.friends}\n消息: ${stats.messages}\n动态: ${stats.posts}`

        uni.showModal({
          title: '恢复成功',
          content: message,
          showCancel: false,
          success: () => {
            this.closeRestoreModal()

            // 重新加载应用
            setTimeout(() => {
              uni.reLaunch({
                url: '/pages/knowledge/list/list'
              })
            }, 1000)
          }
        })
      } catch (error) {
        console.error('恢复备份失败:', error)
        uni.showToast({
          title: '恢复失败: ' + error.message,
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.restoring = false
      }
    },

    /**
     * 恢复备份（快捷）
     */
    restoreBackup(item) {
      this.restoreOptions.selectedBackup = item
      this.restoreOptions.password = ''
      this.restoreOptions.merge = false
      this.showRestoreModal = true
    },

    /**
     * 确认删除备份
     */
    confirmDelete(item) {
      uni.showModal({
        title: '删除备份',
        content: '确定要删除此备份吗？',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            this.deleteBackup(item)
          }
        }
      })
    },

    /**
     * 删除备份
     */
    deleteBackup(item) {
      try {
        backup.deleteBackup(item.fileName)

        uni.showToast({
          title: '已删除',
          icon: 'success'
        })

        this.loadBackupList()
      } catch (error) {
        console.error('删除备份失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
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
.backup-page {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 100rpx;
}

.quick-actions {
  padding: 24rpx;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20rpx;

  .action-card {
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx 24rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12rpx;
    box-shadow: var(--shadow-sm);

    .action-icon {
      font-size: 64rpx;
    }

    .action-title {
      font-size: 28rpx;
      font-weight: 500;
      color: var(--text-primary);
    }

    .action-desc {
      font-size: 24rpx;
      color: var(--text-tertiary);
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
        line-height: 1.5;
      }
    }

    switch {
      transform: scale(0.9);
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
    margin-bottom: 40rpx;
  }

  .create-btn {
    width: 300rpx;
    height: 80rpx;
    background-color: var(--color-primary);
    color: var(--text-inverse);
    border-radius: 40rpx;
    font-size: 28rpx;
    border: none;
    margin: 0 auto;

    &::after {
      border: none;
    }
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
        margin-bottom: 12rpx;

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

      .backup-platform {
        font-size: 22rpx;
        color: var(--text-tertiary);
        margin-left: 56rpx;
      }
    }

    .backup-actions {
      display: flex;
      gap: 16rpx;

      .action-btn {
        flex: 1;
        height: 64rpx;
        border-radius: 32rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26rpx;

        &.restore {
          background-color: #e6f7ff;
          color: var(--color-info);
        }

        &.delete {
          background-color: #fff1f0;
          color: var(--color-error);
        }
      }
    }
  }
}

// 弹窗样式
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 640rpx;
    max-height: 80vh;
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 40rpx;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .form-section {
      margin-bottom: 32rpx;

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

        .picker-input {
          width: 100%;
          height: 80rpx;
          padding: 0 24rpx;
          background-color: var(--bg-input);
          border-radius: 8rpx;
          display: flex;
          align-items: center;
          font-size: 28rpx;
          color: var(--text-primary);

          .placeholder {
            color: var(--text-tertiary);
          }
        }
      }

      .switch-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 24rpx 0;

        .switch-info {
          flex: 1;
          margin-right: 24rpx;

          .switch-label {
            display: block;
            font-size: 28rpx;
            color: var(--text-primary);
            margin-bottom: 8rpx;
          }

          .switch-desc {
            display: block;
            font-size: 24rpx;
            color: var(--text-tertiary);
            line-height: 1.5;
          }
        }

        switch {
          transform: scale(0.9);
        }
      }

      .warning {
        display: flex;
        align-items: center;
        gap: 12rpx;
        padding: 16rpx 20rpx;
        background-color: #fff7e6;
        border-radius: 8rpx;
        margin-top: 16rpx;

        .warning-icon {
          font-size: 32rpx;
        }

        .warning-text {
          flex: 1;
          font-size: 24rpx;
          color: #fa8c16;
          line-height: 1.5;
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: 20rpx;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 30rpx;
        font-weight: 500;
        border: none;

        &::after {
          border: none;
        }

        &.cancel {
          background-color: var(--bg-input);
          color: var(--text-secondary);
        }

        &.confirm {
          background-color: var(--color-primary);
          color: var(--text-inverse);

          &[disabled] {
            opacity: 0.5;
          }
        }
      }
    }
  }
}
</style>
