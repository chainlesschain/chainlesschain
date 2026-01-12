<template>
  <view class="share-select-container">
    <view class="header">
      <text class="title">选择好友</text>
      <button class="cancel-btn" @click="goBack">取消</button>
    </view>

    <view class="search-box">
      <input
        class="search-input"
        v-model="searchQuery"
        placeholder="搜索好友"
        @input="onSearch"
      />
    </view>

    <scroll-view class="friends-list" scroll-y>
      <view v-if="loading" class="loading">
        <text>加载中...</text>
      </view>

      <view v-else-if="filteredFriends.length === 0" class="empty">
        <text class="empty-icon">👥</text>
        <text class="empty-text">没有找到好友</text>
      </view>

      <view v-else class="friends">
        <view
          class="friend-item"
          v-for="friend in filteredFriends"
          :key="friend.did"
          :class="{ selected: selectedFriends.includes(friend.did) }"
          @click="toggleFriend(friend)"
        >
          <view class="friend-avatar">
            <text class="avatar-text">{{ getFriendAvatar(friend) }}</text>
          </view>
          <view class="friend-info">
            <text class="friend-name">{{ getFriendName(friend) }}</text>
            <text class="friend-did">{{ formatDid(friend.did) }}</text>
          </view>
          <view class="checkbox">
            <text v-if="selectedFriends.includes(friend.did)">✓</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <view class="footer" v-if="selectedFriends.length > 0">
      <text class="selected-count">已选择 {{ selectedFriends.length }} 位好友</text>
      <button class="send-btn" @click="sendShare">发送</button>
    </view>
  </view>
</template>

<script>
import friendService from '@/services/friends'
import messagingService from '@/services/messaging'
import postsService from '@/services/posts'

export default {
  data() {
    return {
      postId: '',
      shareType: 'post',
      friends: [],
      filteredFriends: [],
      selectedFriends: [],
      searchQuery: '',
      loading: false
    }
  },

  onLoad(options) {
    this.postId = options.postId || ''
    this.shareType = options.type || 'post'
    this.loadFriends()
  },

  methods: {
    async loadFriends() {
      this.loading = true
      try {
        await friendService.init()
        this.friends = await friendService.getFriends()
        this.filteredFriends = [...this.friends]
      } catch (error) {
        console.error('加载好友列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    onSearch() {
      if (!this.searchQuery.trim()) {
        this.filteredFriends = [...this.friends]
        return
      }

      const query = this.searchQuery.toLowerCase()
      this.filteredFriends = this.friends.filter(friend => {
        const name = this.getFriendName(friend).toLowerCase()
        const did = friend.did.toLowerCase()
        return name.includes(query) || did.includes(query)
      })
    },

    toggleFriend(friend) {
      const index = this.selectedFriends.indexOf(friend.did)
      if (index > -1) {
        this.selectedFriends.splice(index, 1)
      } else {
        this.selectedFriends.push(friend.did)
      }
    },

    async sendShare() {
      if (this.selectedFriends.length === 0) {
        return
      }

      try {
        uni.showLoading({ title: '发送中...' })

        // 获取动态内容
        const post = await postsService.getPostById(this.postId)
        if (!post) {
          throw new Error('动态不存在')
        }

        // 构建分享消息
        const shareMessage = {
          type: 'share',
          content: `[分享动态] ${post.content.substring(0, 50)}${post.content.length > 50 ? '...' : ''}`,
          metadata: {
            shareType: 'post',
            postId: this.postId,
            postContent: post.content,
            postAuthor: post.authorDid,
            postImages: post.images || []
          }
        }

        // 发送给所有选中的好友
        await messagingService.init()
        const promises = this.selectedFriends.map(friendDid =>
          messagingService.sendMessage(friendDid, shareMessage)
        )

        await Promise.all(promises)

        uni.hideLoading()
        uni.showToast({
          title: '分享成功',
          icon: 'success'
        })

        setTimeout(() => {
          this.goBack()
        }, 1500)
      } catch (error) {
        uni.hideLoading()
        console.error('分享失败:', error)
        uni.showToast({
          title: error.message || '分享失败',
          icon: 'none'
        })
      }
    },

    goBack() {
      uni.navigateBack()
    },

    getFriendAvatar(friend) {
      if (friend.nickname) {
        return friend.nickname.substring(0, 2)
      }
      return friend.did ? friend.did.slice(-2).toUpperCase() : '?'
    },

    getFriendName(friend) {
      return friend.nickname || this.formatDid(friend.did)
    },

    formatDid(did) {
      if (!did || did.length <= 32) {
        return did
      }
      return `${did.substring(0, 20)}...${did.slice(-6)}`
    }
  }
}
</script>

<style lang="scss" scoped>
.share-select-container {
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
    font-size: 36rpx;
    font-weight: bold;
    color: var(--text-primary);
  }

  .cancel-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 28rpx;
    padding: 0;

    &::after {
      border: none;
    }
  }
}

.search-box {
  padding: 24rpx 32rpx;
  background: var(--bg-card);

  .search-input {
    width: 100%;
    height: 72rpx;
    background: var(--bg-secondary);
    border-radius: 36rpx;
    padding: 0 32rpx;
    font-size: 28rpx;
    color: var(--text-primary);
  }
}

.friends-list {
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
  }
}

.friends {
  padding: 16rpx 0;
}

.friend-item {
  background: var(--bg-card);
  padding: 24rpx 32rpx;
  display: flex;
  align-items: center;
  border-bottom: 1rpx solid var(--border-color);

  &.selected {
    background: var(--bg-accent-light);
  }

  .friend-avatar {
    width: 80rpx;
    height: 80rpx;
    border-radius: 40rpx;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 24rpx;

    .avatar-text {
      font-size: 32rpx;
      font-weight: bold;
      color: white;
    }
  }

  .friend-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .friend-name {
      font-size: 28rpx;
      font-weight: bold;
      color: var(--text-primary);
    }

    .friend-did {
      font-size: 22rpx;
      color: var(--text-tertiary);
    }
  }

  .checkbox {
    width: 48rpx;
    height: 48rpx;
    border: 2rpx solid var(--border-color);
    border-radius: 24rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32rpx;
    color: var(--color-success);
  }

  &.selected .checkbox {
    background: var(--color-success);
    border-color: var(--color-success);
    color: white;
  }
}

.footer {
  background: var(--bg-card);
  padding: 24rpx 32rpx;
  border-top: 2rpx solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 -4rpx 16rpx rgba(0, 0, 0, 0.05);

  .selected-count {
    font-size: 28rpx;
    color: var(--text-secondary);
  }

  .send-btn {
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
</style>
