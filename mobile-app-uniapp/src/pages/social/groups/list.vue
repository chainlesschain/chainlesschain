<template>
  <view class="group-list-container">
    <view class="header">
      <text class="title">群聊</text>
      <button class="create-btn" @click="goToCreateGroup">
        <text class="icon">➕</text>
      </button>
    </view>

    <scroll-view
      class="groups-list"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="loading">
        <text>加载中...</text>
      </view>

      <view v-else-if="groups.length === 0" class="empty">
        <text class="empty-icon">👥</text>
        <text class="empty-text">还没有群聊</text>
        <button class="create-group-btn" @click="goToCreateGroup">
          创建群聊
        </button>
      </view>

      <view v-else class="groups">
        <view
          class="group-item"
          v-for="group in groups"
          :key="group.id"
          @click="openGroupChat(group)"
        >
          <view class="group-avatar">
            <text class="avatar-text">{{ getGroupAvatar(group) }}</text>
          </view>
          <view class="group-info">
            <view class="group-header">
              <text class="group-name">{{ group.name }}</text>
              <text class="member-count">({{ group.members.length }})</text>
            </view>
            <text class="group-desc">{{ group.description || '暂无群简介' }}</text>
          </view>
          <view class="group-arrow">
            <text>›</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import groupChatService from '@/services/group-chat'

export default {
  data() {
    return {
      groups: [],
      loading: false,
      refreshing: false
    }
  },

  onLoad() {
    this.loadGroups()
  },

  onShow() {
    this.loadGroups()
  },

  methods: {
    async loadGroups() {
      this.loading = true
      try {
        await groupChatService.init()
        this.groups = await groupChatService.getGroups()
      } catch (error) {
        console.error('加载群聊列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    async onRefresh() {
      this.refreshing = true
      try {
        await this.loadGroups()
      } finally {
        this.refreshing = false
      }
    },

    goToCreateGroup() {
      uni.navigateTo({
        url: '/pages/social/groups/create'
      })
    },

    openGroupChat(group) {
      uni.navigateTo({
        url: `/pages/social/groups/chat?groupId=${group.id}`
      })
    },

    getGroupAvatar(group) {
      return group.name.substring(0, 2)
    }
  }
}
</script>

<style lang="scss" scoped>
.group-list-container {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--bg-card);
  padding: 32rpx;
  border-bottom: 2rpx solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;

  .title {
    font-size: 44rpx;
    font-weight: bold;
    color: var(--text-primary);
  }

  .create-btn {
    width: 64rpx;
    height: 64rpx;
    background: var(--bg-accent);
    border-radius: 32rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    padding: 0;

    &::after {
      border: none;
    }

    .icon {
      font-size: 32rpx;
    }
  }
}

.groups-list {
  flex: 1;
}

.loading,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 48rpx;

  .empty-icon {
    font-size: 96rpx;
    margin-bottom: 24rpx;
    opacity: 0.5;
  }

  .empty-text {
    font-size: 28rpx;
    color: var(--text-secondary);
    margin-bottom: 32rpx;
  }

  .create-group-btn {
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 48rpx;
    padding: 16rpx 48rpx;
    font-size: 28rpx;

    &::after {
      border: none;
    }
  }
}

.groups {
  padding: 16rpx 0;
}

.group-item {
  background: var(--bg-card);
  padding: 24rpx 32rpx;
  display: flex;
  align-items: center;
  border-bottom: 1rpx solid var(--border-color);

  .group-avatar {
    width: 96rpx;
    height: 96rpx;
    border-radius: 16rpx;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 24rpx;

    .avatar-text {
      font-size: 36rpx;
      font-weight: bold;
      color: white;
    }
  }

  .group-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .group-header {
      display: flex;
      align-items: center;
      gap: 8rpx;

      .group-name {
        font-size: 30rpx;
        font-weight: bold;
        color: var(--text-primary);
      }

      .member-count {
        font-size: 22rpx;
        color: var(--text-tertiary);
      }
    }

    .group-desc {
      font-size: 24rpx;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .group-arrow {
    font-size: 48rpx;
    color: var(--text-tertiary);
  }
}
</style>
