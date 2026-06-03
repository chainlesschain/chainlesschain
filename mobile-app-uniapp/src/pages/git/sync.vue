<template>
  <view class="git-sync-page">
    <!-- 顶部导航栏 -->
    <view class="navbar">
      <view class="navbar-left" @click="goBack">
        <text class="icon-back">←</text>
      </view>
      <view class="navbar-title">Git同步</view>
      <view class="navbar-right" @click="showHelp">
        <text class="icon-help">?</text>
      </view>
    </view>

    <!-- 同步状态卡片 -->
    <view class="status-card">
      <view class="status-header">
        <text class="status-title">同步状态</text>
        <view class="status-badge" :class="statusClass">
          {{ statusText }}
        </view>
      </view>

      <view class="status-info">
        <view class="info-item">
          <text class="info-label">当前分支:</text>
          <text class="info-value">{{ status.branch || '-' }}</text>
        </view>
        <view class="info-item">
          <text class="info-label">待推送:</text>
          <text class="info-value">{{ status.ahead || 0 }} 个提交</text>
        </view>
        <view class="info-item">
          <text class="info-label">待拉取:</text>
          <text class="info-value">{{ status.behind || 0 }} 个提交</text>
        </view>
        <view class="info-item">
          <text class="info-label">本地更改:</text>
          <text class="info-value">{{ totalChanges }} 个文件</text>
        </view>
        <view class="info-item">
          <text class="info-label">最后同步:</text>
          <text class="info-value">{{ lastSyncText }}</text>
        </view>
      </view>

      <!-- 同步按钮 -->
      <view class="sync-actions">
        <button class="btn btn-primary" @click="handleSync" :disabled="syncing">
          <text v-if="!syncing">{{ syncButtonText }}</text>
          <text v-else>同步中...</text>
        </button>
        <button class="btn btn-secondary" @click="refreshStatus" :disabled="loading">
          刷新状态
        </button>
      </view>
    </view>

    <!-- 更改列表 -->
    <view class="changes-section" v-if="hasChanges">
      <view class="section-header">
        <text class="section-title">本地更改</text>
        <text class="section-count">{{ totalChanges }}</text>
      </view>

      <!-- 已修改 -->
      <view class="change-group" v-if="status.modified && status.modified.length > 0">
        <view class="group-header">
          <text class="group-icon">📝</text>
          <text class="group-title">已修改 ({{ status.modified.length }})</text>
        </view>
        <view class="file-list">
          <view class="file-item" v-for="(file, index) in status.modified" :key="'m-' + index">
            <text class="file-name">{{ file }}</text>
          </view>
        </view>
      </view>

      <!-- 未跟踪 -->
      <view class="change-group" v-if="status.untracked && status.untracked.length > 0">
        <view class="group-header">
          <text class="group-icon">➕</text>
          <text class="group-title">未跟踪 ({{ status.untracked.length }})</text>
        </view>
        <view class="file-list">
          <view class="file-item" v-for="(file, index) in status.untracked" :key="'u-' + index">
            <text class="file-name">{{ file }}</text>
          </view>
        </view>
      </view>

      <!-- 已删除 -->
      <view class="change-group" v-if="status.deleted && status.deleted.length > 0">
        <view class="group-header">
          <text class="group-icon">🗑️</text>
          <text class="group-title">已删除 ({{ status.deleted.length }})</text>
        </view>
        <view class="file-list">
          <view class="file-item" v-for="(file, index) in status.deleted" :key="'d-' + index">
            <text class="file-name">{{ file }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 提交历史 -->
    <view class="history-section">
      <view class="section-header">
        <text class="section-title">提交历史</text>
        <text class="section-action" @click="loadMoreHistory">加载更多</text>
      </view>

      <view class="commit-list">
        <view class="commit-item" v-for="(commit, index) in commitHistory" :key="commit.oid">
          <view class="commit-header">
            <text class="commit-message">{{ commit.message }}</text>
            <text class="commit-time">{{ formatTime(commit.timestamp) }}</text>
          </view>
          <view class="commit-meta">
            <text class="commit-author">{{ commit.author }}</text>
            <text class="commit-oid">{{ commit.oid.substring(0, 7) }}</text>
          </view>
        </view>

        <view class="empty-state" v-if="commitHistory.length === 0">
          <text class="empty-text">暂无提交历史</text>
        </view>
      </view>
    </view>

    <!-- Git设置入口 -->
    <view class="settings-entry" @click="goToSettings">
      <text class="entry-icon">⚙️</text>
      <text class="entry-text">Git设置</text>
      <text class="entry-arrow">→</text>
    </view>
  </view>
</template>

<script>
import { gitService } from '@/services/git/git-service';

export default {
  name: 'GitSyncPage',
  data() {
    return {
      loading: false,
      syncing: false,
      status: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        modified: [],
        untracked: [],
        deleted: [],
        lastSync: null,
        hasChanges: false
      },
      commitHistory: [],
      historyLimit: 20
    };
  },
  computed: {
    statusClass() {
      if (this.syncing) return 'status-syncing';
      if (this.status.hasChanges) return 'status-changes';
      if (this.status.ahead > 0 || this.status.behind > 0) return 'status-diverged';
      return 'status-synced';
    },
    statusText() {
      if (this.syncing) return '同步中';
      if (this.status.hasChanges) return '有更改';
      if (this.status.ahead > 0 || this.status.behind > 0) return '需要同步';
      return '已同步';
    },
    totalChanges() {
      return (this.status.modified?.length || 0) +
             (this.status.untracked?.length || 0) +
             (this.status.deleted?.length || 0);
    },
    hasChanges() {
      return this.totalChanges > 0;
    },
    lastSyncText() {
      if (!this.status.lastSync) return '从未同步';
      return this.formatTime(this.status.lastSync);
    },
    syncButtonText() {
      if (this.status.hasChanges) return '提交并同步';
      if (this.status.ahead > 0) return '推送更改';
      if (this.status.behind > 0) return '拉取更新';
      return '同步';
    }
  },
  onLoad() {
    this.initGit();
  },
  onShow() {
    this.refreshStatus();
  },
  methods: {
    async initGit() {
      try {
        this.loading = true;
        await gitService.initialize();
        await this.refreshStatus();
        await this.loadCommitHistory();
      } catch (error) {
        console.error('初始化Git失败:', error);
        uni.showToast({
          title: '初始化失败',
          icon: 'none'
        });
      } finally {
        this.loading = false;
      }
    },
    async refreshStatus() {
      try {
        this.loading = true;
        this.status = await gitService.getStatus();
      } catch (error) {
        console.error('获取状态失败:', error);
        uni.showToast({
          title: '获取状态失败',
          icon: 'none'
        });
      } finally {
        this.loading = false;
      }
    },
    async handleSync() {
      try {
        this.syncing = true;

        // 如果有更改，先让用户输入提交消息
        let commitMessage = '自动同步';
        if (this.status.hasChanges) {
          const res = await this.showCommitMessageDialog();
          if (!res) {
            this.syncing = false;
            return;
          }
          commitMessage = res;
        }

        // 执行同步
        await gitService.sync(commitMessage);

        uni.showToast({
          title: '同步成功',
          icon: 'success'
        });

        // 刷新状态和历史
        await this.refreshStatus();
        await this.loadCommitHistory();
      } catch (error) {
        console.error('同步失败:', error);
        uni.showModal({
          title: '同步失败',
          content: error.message || '同步过程中发生错误',
          showCancel: false
        });
      } finally {
        this.syncing = false;
      }
    },
    showCommitMessageDialog() {
      return new Promise((resolve) => {
        uni.showModal({
          title: '提交消息',
          editable: true,
          placeholderText: '请输入提交消息',
          success: (res) => {
            if (res.confirm) {
              resolve(res.content || '更新知识库');
            } else {
              resolve(null);
            }
          }
        });
      });
    },
    async loadCommitHistory() {
      try {
        this.commitHistory = await gitService.getCommitHistory(this.historyLimit);
      } catch (error) {
        console.error('加载提交历史失败:', error);
      }
    },
    async loadMoreHistory() {
      this.historyLimit += 20;
      await this.loadCommitHistory();
    },
    formatTime(date) {
      if (!date) return '-';
      const d = new Date(date);
      const now = new Date();
      const diff = now - d;

      // 小于1分钟
      if (diff < 60000) {
        return '刚刚';
      }
      // 小于1小时
      if (diff < 3600000) {
        return `${Math.floor(diff / 60000)}分钟前`;
      }
      // 小于1天
      if (diff < 86400000) {
        return `${Math.floor(diff / 3600000)}小时前`;
      }
      // 小于7天
      if (diff < 604800000) {
        return `${Math.floor(diff / 86400000)}天前`;
      }

      // 格式化日期
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    goToSettings() {
      uni.navigateTo({
        url: '/pages/settings/git-settings'
      });
    },
    showHelp() {
      uni.showModal({
        title: 'Git同步帮助',
        content: 'Git同步功能可以将您的知识库备份到远程仓库，实现多设备同步和版本控制。\n\n使用前请先在设置中配置远程仓库地址和认证信息。',
        showCancel: false
      });
    },
    goBack() {
      uni.navigateBack();
    }
  }
};
</script>

<style scoped>
.git-sync-page {
  min-height: 100vh;
  background: #f5f5f5;
  padding-bottom: 20rpx;
}

/* 导航栏 */
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  padding: 0 30rpx;
  background: #fff;
  border-bottom: 1rpx solid #eee;
}

.navbar-left,
.navbar-right {
  width: 80rpx;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-back,
.icon-help {
  font-size: 40rpx;
  color: #333;
}

.navbar-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

/* 状态卡片 */
.status-card {
  margin: 20rpx 30rpx;
  padding: 30rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
}

.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 30rpx;
}

.status-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

.status-badge {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  font-size: 24rpx;
  font-weight: 500;
}

.status-synced {
  background: #e8f5e9;
  color: #4caf50;
}

.status-changes {
  background: #fff3e0;
  color: #ff9800;
}

.status-diverged {
  background: #e3f2fd;
  color: #2196f3;
}

.status-syncing {
  background: #f3e5f5;
  color: #9c27b0;
}

.status-info {
  margin-bottom: 30rpx;
}

.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
}

.info-item:last-child {
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
}

.sync-actions {
  display: flex;
  gap: 20rpx;
}

.btn {
  flex: 1;
  height: 80rpx;
  border-radius: 12rpx;
  font-size: 28rpx;
  font-weight: 500;
  border: none;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.btn-secondary {
  background: #f5f5f5;
  color: #666;
}

/* 更改列表 */
.changes-section {
  margin: 20rpx 30rpx;
  padding: 30rpx;
  background: #fff;
  border-radius: 16rpx;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.section-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

.section-count {
  padding: 4rpx 16rpx;
  background: #f5f5f5;
  border-radius: 20rpx;
  font-size: 24rpx;
  color: #666;
}

.section-action {
  font-size: 26rpx;
  color: #667eea;
}

.change-group {
  margin-bottom: 30rpx;
}

.change-group:last-child {
  margin-bottom: 0;
}

.group-header {
  display: flex;
  align-items: center;
  margin-bottom: 16rpx;
}

.group-icon {
  font-size: 32rpx;
  margin-right: 12rpx;
}

.group-title {
  font-size: 28rpx;
  font-weight: 500;
  color: #333;
}

.file-list {
  padding-left: 44rpx;
}

.file-item {
  padding: 12rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
}

.file-item:last-child {
  border-bottom: none;
}

.file-name {
  font-size: 26rpx;
  color: #666;
  font-family: monospace;
}

/* 提交历史 */
.history-section {
  margin: 20rpx 30rpx;
  padding: 30rpx;
  background: #fff;
  border-radius: 16rpx;
}

.commit-list {
  margin-top: 20rpx;
}

.commit-item {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
}

.commit-item:last-child {
  border-bottom: none;
}

.commit-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.commit-message {
  flex: 1;
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
  margin-right: 20rpx;
}

.commit-time {
  font-size: 24rpx;
  color: #999;
  white-space: nowrap;
}

.commit-meta {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.commit-author {
  font-size: 24rpx;
  color: #666;
}

.commit-oid {
  padding: 4rpx 12rpx;
  background: #f5f5f5;
  border-radius: 8rpx;
  font-size: 22rpx;
  color: #999;
  font-family: monospace;
}

.empty-state {
  padding: 80rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

/* 设置入口 */
.settings-entry {
  margin: 20rpx 30rpx;
  padding: 30rpx;
  background: #fff;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.entry-icon {
  font-size: 40rpx;
  margin-right: 20rpx;
}

.entry-text {
  flex: 1;
  font-size: 28rpx;
  color: #333;
}

.entry-arrow {
  font-size: 32rpx;
  color: #999;
}
</style>
