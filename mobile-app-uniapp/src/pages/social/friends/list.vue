<template>
  <view class="friends-container">
    <!-- 头部 -->
    <view class="header">
      <view class="header-content">
        <text class="title">好友</text>
        <view class="actions">
          <view class="icon-btn" @click="goToAddFriend">
            <text class="icon">➕</text>
          </view>
        </view>
      </view>

      <!-- 搜索栏 -->
      <view class="search-bar">
        <input
          class="search-input"
          type="text"
          v-model="searchQuery"
          placeholder="搜索好友..."
          @input="handleSearch"
        />
        <text class="search-icon">🔍</text>
      </view>

      <!-- 标签页 -->
      <view class="tabs">
        <view
          class="tab-item"
          :class="{ active: activeTab === 'friends' }"
          @click="activeTab = 'friends'"
        >
          <text class="tab-text">好友</text>
          <text class="tab-count" v-if="friends.length > 0">({{ friends.length }})</text>
        </view>
        <view
          class="tab-item"
          :class="{ active: activeTab === 'requests' }"
          @click="activeTab = 'requests'"
        >
          <text class="tab-text">请求</text>
          <view class="badge" v-if="pendingRequests.length > 0">
            {{ pendingRequests.length }}
          </view>
        </view>
        <view
          class="tab-item"
          :class="{ active: activeTab === 'blocked' }"
          @click="activeTab = 'blocked'"
        >
          <text class="tab-text">黑名单</text>
          <text class="tab-count" v-if="blockedUsers.length > 0">({{ blockedUsers.length }})</text>
        </view>
      </view>
    </view>

    <!-- 内容区域 -->
    <scroll-view
      class="content"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- 好友列表 -->
      <view v-if="activeTab === 'friends'">
        <Skeleton v-if="loading" type="list" :rows="5" :avatar="true" :animate="true" />

        <EmptyState
          v-else-if="loadError"
          icon="⚠️"
          title="加载失败"
          :description="loadError"
          action-text="重试"
          action-icon="🔄"
          icon-style="error"
          @action="retryLoad"
        />

        <EmptyState
          v-else-if="filteredFriends.length === 0"
          icon="👥"
          :title="searchQuery ? '未找到好友' : '还没有好友'"
          :description="searchQuery ? '换个关键词试试' : '快去添加第一个好友吧'"
          :action-text="searchQuery ? '' : '添加好友'"
          action-icon="➕"
          icon-style="info"
          @action="goToAddFriend"
        />

        <view v-else class="friend-list">
          <view
            class="friend-item"
            v-for="friend in filteredFriends"
            :key="friend.friendDid"
            @click="goToFriendProfile(friend)"
          >
            <view class="friend-avatar">
              <text class="avatar-text">{{ getAvatarText(friend) }}</text>
            </view>
            <view class="friend-info">
              <text class="friend-name">{{ friend.nickname || '未命名好友' }}</text>
              <text class="friend-did">{{ formatDid(friend.friendDid) }}</text>
              <text class="friend-notes" v-if="friend.notes">{{ friend.notes }}</text>
            </view>
            <view class="friend-arrow">
              <text>›</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 好友请求 -->
      <view v-if="activeTab === 'requests'">
        <Skeleton v-if="loading" type="list" :rows="3" :avatar="true" :animate="true" />

        <EmptyState
          v-else-if="loadError"
          icon="⚠️"
          title="加载失败"
          :description="loadError"
          action-text="重试"
          action-icon="🔄"
          icon-style="error"
          @action="retryLoad"
        />

        <EmptyState
          v-else-if="pendingRequests.length === 0"
          icon="📬"
          title="暂无好友请求"
          description="当有人向你发送好友请求时会显示在这里"
          icon-style="info"
        />

        <view v-else class="request-list">
          <view
            class="request-item"
            v-for="request in pendingRequests"
            :key="request.id"
          >
            <view class="request-avatar">
              <text class="avatar-text">{{ getRequestAvatarText(request) }}</text>
            </view>
            <view class="request-info">
              <text class="request-did">{{ formatDid(request.fromDid) }}</text>
              <text class="request-message" v-if="request.message">{{ request.message }}</text>
              <text class="request-time">{{ formatTime(request.createdAt) }}</text>
            </view>
            <view class="request-actions">
              <button
                class="accept-btn"
                @click.stop="acceptRequest(request)"
                :disabled="processingRequest === request.id"
              >
                接受
              </button>
              <button
                class="reject-btn"
                @click.stop="rejectRequest(request)"
                :disabled="processingRequest === request.id"
              >
                拒绝
              </button>
            </view>
          </view>
        </view>
      </view>

      <!-- 黑名单 -->
      <view v-if="activeTab === 'blocked'">
        <Skeleton v-if="loading" type="list" :rows="3" :avatar="true" :animate="true" />

        <EmptyState
          v-else-if="loadError"
          icon="⚠️"
          title="加载失败"
          :description="loadError"
          action-text="重试"
          action-icon="🔄"
          icon-style="error"
          @action="retryLoad"
        />

        <EmptyState
          v-else-if="blockedUsers.length === 0"
          icon="🚫"
          title="黑名单为空"
          description="这里会显示被你拉黑的用户"
          icon-style="default"
        />

        <view v-else class="blocked-list">
          <view
            class="blocked-item"
            v-for="blocked in blockedUsers"
            :key="blocked.blockedDid"
          >
            <view class="blocked-avatar">
              <text class="avatar-text">{{ getBlockedAvatarText(blocked) }}</text>
            </view>
            <view class="blocked-info">
              <text class="blocked-did">{{ formatDid(blocked.blockedDid) }}</text>
              <text class="blocked-reason" v-if="blocked.reason">原因：{{ blocked.reason }}</text>
              <text class="blocked-time">{{ formatTime(blocked.createdAt) }}</text>
            </view>
            <button
              class="unblock-btn"
              @click.stop="unblockUser(blocked)"
            >
              解除
            </button>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import friendService from '@/services/friends'
import EmptyState from '@/components/EmptyState.vue'
import LoadingState from '@/components/LoadingState.vue'
import Skeleton from '@/components/Skeleton.vue'

export default {
  components: {
    EmptyState,
    LoadingState,
    Skeleton
  },
  data() {
    return {
      activeTab: 'friends', // friends, requests, blocked
      friends: [],
      pendingRequests: [],
      blockedUsers: [],
      searchQuery: '',
      loading: false,
      refreshing: false,
      processingRequest: null,
      loadError: null
    }
  },

  computed: {
    filteredFriends() {
      if (!this.searchQuery) {
        return this.friends
      }
      const query = this.searchQuery.toLowerCase()
      return this.friends.filter(f =>
        (f.nickname && f.nickname.toLowerCase().includes(query)) ||
        f.friendDid.toLowerCase().includes(query) ||
        (f.notes && f.notes.toLowerCase().includes(query))
      )
    }
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    // 每次显示页面时刷新数据
    this.loadData()
  },

  methods: {
    async loadData() {
      this.loading = true
      this.loadError = null

      try {
        await friendService.init()
        await Promise.all([
          this.loadFriends(),
          this.loadPendingRequests(),
          this.loadBlockedUsers()
        ])
      } catch (error) {
        console.error('加载数据失败:', error)
        this.loadError = error.message || '加载失败'

        // 根据错误类型提供友好提示
        let errorMsg = '加载失败，请稍后重试'
        if (error.message) {
          if (error.message.includes('网络') || error.message.includes('timeout')) {
            errorMsg = '网络连接失败，请检查网络'
          } else if (error.message.includes('database') || error.message.includes('数据库')) {
            errorMsg = '数据库错误，请重启应用'
          } else {
            errorMsg = error.message
          }
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2500
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 下拉刷新
     */
    async onRefresh() {
      this.refreshing = true

      try {
        await friendService.init()
        await Promise.all([
          this.loadFriends(),
          this.loadPendingRequests(),
          this.loadBlockedUsers()
        ])

        // 成功提示
        uni.showToast({
          title: '✓ 刷新成功',
          icon: 'none',
          duration: 1000
        })
      } catch (error) {
        console.error('刷新失败:', error)
        uni.showToast({
          title: '刷新失败',
          icon: 'none',
          duration: 1500
        })
      } finally {
        this.refreshing = false
      }
    },

    /**
     * 重试加载
     */
    retryLoad() {
      this.loadData()
    },

    async loadFriends() {
      try {
        this.friends = await friendService.getFriends({ sort: 'createdAt' })
      } catch (error) {
        console.error('加载好友列表失败:', error)
      }
    },

    async loadPendingRequests() {
      try {
        this.pendingRequests = await friendService.getPendingRequests('received')
      } catch (error) {
        console.error('加载好友请求失败:', error)
      }
    },

    async loadBlockedUsers() {
      try {
        this.blockedUsers = await friendService.getBlockedUsers()
      } catch (error) {
        console.error('加载黑名单失败:', error)
      }
    },

    handleSearch() {
      // 搜索已在computed中处理
    },

    async acceptRequest(request) {
      // 防止重复点击
      if (this.processingRequest === request.id) {
        return
      }

      this.processingRequest = request.id

      try {
        await friendService.acceptFriendRequest(request.id)

        uni.showToast({
          title: '✓ 已接受好友请求',
          icon: 'success',
          duration: 1500
        })

        // 刷新数据
        await this.loadData()
      } catch (error) {
        console.error('接受好友请求失败:', error)

        let errorMsg = '操作失败，请稍后重试'
        if (error.message) {
          if (error.message.includes('已接受') || error.message.includes('已是好友')) {
            errorMsg = '该用户已是您的好友'
            // 也刷新数据以同步状态
            await this.loadData()
          } else if (error.message.includes('不存在')) {
            errorMsg = '请求已过期'
            await this.loadPendingRequests()
          } else {
            errorMsg = error.message
          }
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.processingRequest = null
      }
    },

    async rejectRequest(request) {
      // 防止重复点击
      if (this.processingRequest === request.id) {
        return
      }

      // 确认对话框
      const confirm = await new Promise((resolve) => {
        uni.showModal({
          title: '确认拒绝',
          content: '确定要拒绝该好友请求吗？',
          success: (res) => {
            resolve(res.confirm)
          }
        })
      })

      if (!confirm) {
        return
      }

      this.processingRequest = request.id

      try {
        await friendService.rejectFriendRequest(request.id)

        uni.showToast({
          title: '✓ 已拒绝',
          icon: 'success',
          duration: 1500
        })

        // 刷新数据
        await this.loadPendingRequests()
      } catch (error) {
        console.error('拒绝好友请求失败:', error)

        let errorMsg = '操作失败，请稍后重试'
        if (error.message) {
          if (error.message.includes('不存在')) {
            errorMsg = '请求已过期'
            await this.loadPendingRequests()
          } else {
            errorMsg = error.message
          }
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.processingRequest = null
      }
    },

    async unblockUser(blocked) {
      // 确认对话框
      const confirm = await new Promise((resolve) => {
        uni.showModal({
          title: '解除拉黑',
          content: `确定要解除拉黑 ${this.formatDid(blocked.blockedDid)} 吗？`,
          showCancel: true,
          confirmText: '解除',
          success: (res) => {
            resolve(res.confirm)
          }
        })
      })

      if (!confirm) {
        return
      }

      try {
        await friendService.unblockUser(blocked.blockedDid)

        uni.showToast({
          title: '✓ 已解除拉黑',
          icon: 'success',
          duration: 1500
        })

        // 刷新黑名单
        await this.loadBlockedUsers()
      } catch (error) {
        console.error('解除拉黑失败:', error)

        let errorMsg = '操作失败，请稍后重试'
        if (error.message) {
          if (error.message.includes('不存在')) {
            errorMsg = '该用户已不在黑名单中'
            await this.loadBlockedUsers()
          } else {
            errorMsg = error.message
          }
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })
      }
    },

    goToAddFriend() {
      uni.navigateTo({
        url: '/pages/social/friends/add'
      })
    },

    goToFriendProfile(friend) {
      uni.navigateTo({
        url: `/pages/social/friends/profile?did=${friend.friendDid}`
      })
    },

    getAvatarText(friend) {
      if (friend.nickname) {
        return friend.nickname.substring(0, 2)
      }
      // 使用DID最后2个字符
      return friend.friendDid.slice(-2).toUpperCase()
    },

    getRequestAvatarText(request) {
      return request.fromDid.slice(-2).toUpperCase()
    },

    getBlockedAvatarText(blocked) {
      return blocked.blockedDid.slice(-2).toUpperCase()
    },

    formatDid(did) {
      // 显示前8位...后8位
      if (did.length <= 24) {
        return did
      }
      return `${did.substring(0, 24)}...${did.slice(-8)}`
    },

    formatTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      // 少于1分钟
      if (diff < 60000) {
        return '刚刚'
      }
      // 少于1小时
      if (diff < 3600000) {
        return `${Math.floor(diff / 60000)}分钟前`
      }
      // 少于1天
      if (diff < 86400000) {
        return `${Math.floor(diff / 3600000)}小时前`
      }
      // 少于7天
      if (diff < 604800000) {
        return `${Math.floor(diff / 86400000)}天前`
      }
      // 显示日期
      return `${date.getMonth() + 1}月${date.getDate()}日`
    }
  }
}
</script>

<style lang="scss" scoped>
.friends-container {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--bg-card);
  border-bottom: 2rpx solid var(--border-color);
  padding-bottom: 16rpx;

  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 32rpx 32rpx 24rpx;

    .title {
      font-size: 44rpx;
      font-weight: bold;
      color: var(--text-primary);
    }

    .actions {
      display: flex;
      gap: 16rpx;

      .icon-btn {
        width: 64rpx;
        height: 64rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-accent);
        border-radius: 32rpx;

        .icon {
          font-size: 32rpx;
          color: var(--text-on-accent);
        }
      }
    }
  }

  .search-bar {
    margin: 0 32rpx 24rpx;
    position: relative;

    .search-input {
      width: 100%;
      height: 72rpx;
      background: var(--bg-secondary);
      border-radius: 36rpx;
      padding: 0 64rpx 0 32rpx;
      font-size: 28rpx;
      color: var(--text-primary);
    }

    .search-icon {
      position: absolute;
      right: 24rpx;
      top: 50%;
      transform: translateY(-50%);
      font-size: 28rpx;
    }
  }

  .tabs {
    display: flex;
    padding: 0 32rpx;

    .tab-item {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16rpx 0;
      position: relative;
      gap: 8rpx;

      .tab-text {
        font-size: 28rpx;
        color: var(--text-secondary);
      }

      .tab-count {
        font-size: 24rpx;
        color: var(--text-tertiary);
      }

      .badge {
        min-width: 32rpx;
        height: 32rpx;
        background: var(--color-error);
        color: white;
        border-radius: 16rpx;
        font-size: 20rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 8rpx;
      }

      &.active {
        .tab-text {
          color: var(--text-link);
          font-weight: bold;
        }

        &::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 48rpx;
          height: 6rpx;
          background: var(--text-link);
          border-radius: 3rpx;
        }
      }
    }
  }
}

.content {
  flex: 1;
  padding: 16rpx 0;
}

.loading,
.empty,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 48rpx;

  .loading-icon,
  .empty-icon,
  .error-icon {
    font-size: 96rpx;
    margin-bottom: 24rpx;
    opacity: 0.5;
  }

  .loading-text,
  .empty-text,
  .error-text {
    font-size: 28rpx;
    color: var(--text-secondary);
    margin-bottom: 32rpx;
    text-align: center;
  }

  .add-btn,
  .retry-btn {
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 48rpx;
    padding: 16rpx 48rpx;
    font-size: 28rpx;

    &::after {
      border: none;
    }

    &:active {
      opacity: 0.8;
    }
  }

  .retry-btn {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 2rpx solid var(--border-color);
  }
}

.error-state {
  .error-icon {
    opacity: 0.7;
  }

  .error-text {
    color: var(--color-error);
  }
}

.friend-list,
.request-list,
.blocked-list {
  padding: 0 32rpx;
}

.friend-item,
.request-item,
.blocked-item {
  display: flex;
  align-items: center;
  padding: 24rpx;
  background: var(--bg-card);
  border-radius: 16rpx;
  margin-bottom: 16rpx;
  gap: 24rpx;
}

.friend-avatar,
.request-avatar,
.blocked-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 48rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;

  .avatar-text {
    font-size: 36rpx;
    font-weight: bold;
    color: white;
  }
}

.friend-info,
.request-info,
.blocked-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;

  .friend-name,
  .request-did,
  .blocked-did {
    font-size: 32rpx;
    font-weight: bold;
    color: var(--text-primary);
  }

  .friend-did,
  .request-message,
  .blocked-reason {
    font-size: 24rpx;
    color: var(--text-secondary);
  }

  .friend-notes,
  .request-time,
  .blocked-time {
    font-size: 22rpx;
    color: var(--text-tertiary);
  }
}

.friend-arrow {
  font-size: 48rpx;
  color: var(--text-tertiary);
}

.request-actions {
  display: flex;
  flex-direction: column;
  gap: 12rpx;

  .accept-btn,
  .reject-btn {
    padding: 12rpx 24rpx;
    border-radius: 24rpx;
    font-size: 24rpx;
    border: none;

    &::after {
      border: none;
    }

    &:disabled {
      opacity: 0.5;
    }
  }

  .accept-btn {
    background: var(--bg-accent);
    color: var(--text-on-accent);
  }

  .reject-btn {
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }
}

.unblock-btn {
  padding: 12rpx 32rpx;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: none;
  border-radius: 24rpx;
  font-size: 24rpx;

  &::after {
    border: none;
  }
}
</style>
