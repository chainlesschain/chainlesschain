<template>
  <view class="messages-container">
    <!-- 头部 -->
    <view class="header">
      <text class="title">消息</text>
      <button class="new-btn" @click="showNewMessage">
        <text>➕</text>
      </button>
    </view>

    <scroll-view class="list-container" scroll-y @scrolltolower="loadMore">
      <!-- 加载状态 -->
      <view class="loading" v-if="loading && conversations.length === 0">
        <text>加载中...</text>
      </view>

      <!-- 空状态 -->
      <view class="empty" v-else-if="conversations.length === 0">
        <text class="empty-icon">💬</text>
        <text class="empty-text">暂无消息</text>
        <text class="empty-hint">点击右上角 ➕ 开始新对话</text>
      </view>

      <!-- 对话列表 -->
      <view
        class="conversation-item"
        v-for="conv in conversations"
        :key="conv.id"
        @click="openChat(conv)"
      >
        <view class="avatar">
          <text>👤</text>
          <view class="badge" v-if="conv.unreadCount > 0">
            <text>{{ conv.unreadCount > 99 ? '99+' : conv.unreadCount }}</text>
          </view>
        </view>

        <view class="content">
          <view class="top">
            <text class="nickname">{{ conv.nickname }}</text>
            <text class="time">{{ formatTime(conv.updated_at) }}</text>
          </view>
          <view class="bottom">
            <text class="last-message" v-if="conv.lastMessage">
              <text v-if="conv.lastMessage.isSent" class="sender-tag">[我] </text>
              {{ conv.lastMessage.content }}
            </text>
            <text class="no-message" v-else>暂无消息</text>
          </view>
        </view>

        <view class="arrow">
          <text>›</text>
        </view>
      </view>
    </scroll-view>

    <!-- 新建对话弹窗 -->
    <view class="modal" v-if="showModal" @click="closeModal">
      <view class="modal-content" @click.stop>
        <text class="modal-title">新建对话</text>

        <view class="modal-form">
          <view class="form-item">
            <text class="label">选择好友</text>
            <picker
              mode="selector"
              :range="friends"
              range-key="nickname"
              @change="handleFriendSelect"
            >
              <view class="picker">
                <text v-if="selectedFriend">{{ selectedFriend.nickname }}</text>
                <text v-else class="placeholder">请选择好友</text>
                <text class="arrow">▼</text>
              </view>
            </picker>
          </view>

          <view class="form-hint">
            <text>或者在好友列表中点击好友头像发起对话</text>
          </view>
        </view>

        <view class="modal-actions">
          <button class="cancel-btn" @click="closeModal">
            <text>取消</text>
          </button>
          <button
            class="confirm-btn"
            :class="{ disabled: !selectedFriend }"
            :disabled="!selectedFriend"
            @click="createNewChat"
          >
            <text>开始对话</text>
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      conversations: [],
      friends: [],
      loading: false,
      showModal: false,
      selectedFriend: null
    }
  },
  onLoad() {
    this.loadConversations()
    this.loadFriends()
  },
  onShow() {
    // 每次显示时刷新对话列表
    this.loadConversations()
  },
  methods: {
    /**
     * 加载对话列表
     */
    async loadConversations() {
      try {
        this.loading = true
        const conversations = await db.getFriendConversations()
        this.conversations = conversations
        console.log('加载对话列表:', conversations.length)
      } catch (error) {
        console.error('加载对话列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载好友列表
     */
    async loadFriends() {
      try {
        // 从数据库获取好友列表
        const sql = `SELECT * FROM friendships WHERE status = 'accepted' ORDER BY created_at DESC`
        const result = await db.selectSql(sql, [])

        this.friends = (result || []).map(f => ({
          did: f.friend_did,
          nickname: f.nickname || f.friend_did.substring(0, 12) + '...'
        }))

        console.log('加载好友列表:', this.friends.length)
      } catch (error) {
        console.error('加载好友列表失败:', error)
      }
    },

    /**
     * 打开聊天页面
     */
    openChat(conversation) {
      uni.navigateTo({
        url: `/pages/social/friend-chat/friend-chat?friendDid=${conversation.friendDid}&nickname=${encodeURIComponent(conversation.nickname)}`
      })
    },

    /**
     * 显示新建对话弹窗
     */
    showNewMessage() {
      if (this.friends.length === 0) {
        uni.showModal({
          title: '提示',
          content: '您还没有添加好友，请先添加好友',
          confirmText: '去添加',
          success: (res) => {
            if (res.confirm) {
              uni.switchTab({
                url: '/pages/social/friends/friends'
              })
            }
          }
        })
        return
      }

      this.showModal = true
      this.selectedFriend = null
    },

    /**
     * 关闭弹窗
     */
    closeModal() {
      this.showModal = false
      this.selectedFriend = null
    },

    /**
     * 选择好友
     */
    handleFriendSelect(e) {
      const index = e.detail.value
      this.selectedFriend = this.friends[index]
    },

    /**
     * 创建新对话
     */
    async createNewChat() {
      if (!this.selectedFriend) {
        return
      }

      this.closeModal()

      // 跳转到聊天页面
      uni.navigateTo({
        url: `/pages/social/friend-chat/friend-chat?friendDid=${this.selectedFriend.did}&nickname=${encodeURIComponent(this.selectedFriend.nickname)}`
      })
    },

    /**
     * 加载更多
     */
    loadMore() {
      // 预留分页加载功能
      console.log('滚动到底部')
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
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
      } else if (diff < 7 * day) {
        return `${Math.floor(diff / day)}天前`
      } else {
        const date = new Date(timestamp)
        return `${date.getMonth() + 1}/${date.getDate()}`
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.messages-container {
  min-height: 100vh;
  background-color: var(--bg-page);
  display: flex;
  flex-direction: column;
}

.header {
  background-color: var(--bg-card);
  padding: 20rpx 24rpx;
  box-shadow: 0 2rpx 8rpx var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 10;

  .title {
    font-size: 32rpx;
    font-weight: 500;
    color: var(--text-primary);
  }

  .new-btn {
    width: 64rpx;
    height: 64rpx;
    background-color: var(--color-primary);
    color: var(--bg-card);
    border-radius: 32rpx;
    font-size: 32rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    padding: 0;
    line-height: 1;

    &::after {
      border: none;
    }
  }
}

.list-container {
  flex: 1;
  height: calc(100vh - 104rpx);
}

.loading {
  padding: 80rpx 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 28rpx;
}

.empty {
  padding: 200rpx 40rpx;
  text-align: center;

  .empty-icon {
    display: block;
    font-size: 120rpx;
    margin-bottom: 20rpx;
  }

  .empty-text {
    display: block;
    font-size: 32rpx;
    color: var(--text-primary);
    margin-bottom: 16rpx;
  }

  .empty-hint {
    display: block;
    font-size: 24rpx;
    color: var(--text-tertiary);
  }
}

.conversation-item {
  background-color: var(--bg-card);
  padding: 24rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
  border-bottom: 1rpx solid var(--bg-hover);
  transition: background-color 0.2s;

  &:active {
    background-color: var(--bg-input);
  }

  .avatar {
    width: 96rpx;
    height: 96rpx;
    background-color: #e0e0e0;
    border-radius: 48rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48rpx;
    flex-shrink: 0;
    position: relative;

    .badge {
      position: absolute;
      top: -4rpx;
      right: -4rpx;
      min-width: 32rpx;
      height: 32rpx;
      padding: 0 8rpx;
      background-color: var(--color-error);
      border-radius: 16rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2rpx solid var(--bg-card);

      text {
        font-size: 20rpx;
        color: var(--bg-card);
        line-height: 1;
        transform: scale(0.9);
      }
    }
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12rpx;
    overflow: hidden;

    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;

      .nickname {
        font-size: 30rpx;
        font-weight: 500;
        color: var(--text-primary);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .time {
        font-size: 22rpx;
        color: var(--text-tertiary);
        flex-shrink: 0;
        margin-left: 16rpx;
      }
    }

    .bottom {
      .last-message {
        font-size: 26rpx;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;

        .sender-tag {
          color: var(--text-tertiary);
        }
      }

      .no-message {
        font-size: 26rpx;
        color: var(--text-tertiary);
      }
    }
  }

  .arrow {
    font-size: 40rpx;
    color: #ccc;
    flex-shrink: 0;
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
    width: 600rpx;
    background-color: var(--bg-card);
    border-radius: 16rpx;
    overflow: hidden;

    .modal-title {
      display: block;
      padding: 32rpx 32rpx 24rpx;
      font-size: 32rpx;
      font-weight: 500;
      color: var(--text-primary);
      text-align: center;
    }

    .modal-form {
      padding: 0 32rpx 32rpx;

      .form-item {
        margin-bottom: 24rpx;

        .label {
          display: block;
          font-size: 28rpx;
          color: var(--text-secondary);
          margin-bottom: 16rpx;
        }

        .picker {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 72rpx;
          padding: 0 24rpx;
          background-color: var(--bg-input);
          border-radius: 8rpx;
          font-size: 28rpx;
          color: var(--text-primary);

          .placeholder {
            color: var(--text-tertiary);
          }

          .arrow {
            font-size: 20rpx;
            color: var(--text-tertiary);
          }
        }
      }

      .form-hint {
        padding: 16rpx;
        background-color: #fff7e6;
        border-radius: 8rpx;

        text {
          font-size: 24rpx;
          color: var(--color-warning);
          line-height: 1.5;
        }
      }
    }

    .modal-actions {
      display: flex;
      border-top: 1rpx solid var(--bg-hover);

      button {
        flex: 1;
        height: 96rpx;
        border: none;
        border-radius: 0;
        font-size: 30rpx;
        line-height: 96rpx;
        padding: 0;

        &::after {
          border: none;
        }
      }

      .cancel-btn {
        background-color: var(--bg-card);
        color: var(--text-secondary);
        border-right: 1rpx solid var(--bg-hover);
      }

      .confirm-btn {
        background-color: var(--bg-card);
        color: var(--color-primary);
        font-weight: 500;

        &.disabled {
          color: #ccc;
        }
      }
    }
  }
}
</style>
