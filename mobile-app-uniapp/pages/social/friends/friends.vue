<template>
  <view class="friends-container">
    <view class="header">
      <input
        class="search-input"
        type="text"
        v-model="searchQuery"
        placeholder="搜索好友..."
        @input="handleSearch"
      />
      <button class="add-btn" @click="showAddFriend">
        <text>➕</text>
      </button>
    </view>

    <view class="tabs">
      <view
        class="tab-item"
        :class="{ active: currentTab === 'all' }"
        @click="switchTab('all')"
      >
        <text>全部好友 ({{ friends.length }})</text>
      </view>
      <view
        class="tab-item"
        :class="{ active: currentTab === 'pending' }"
        @click="switchTab('pending')"
      >
        <text>待验证 ({{ pendingCount }})</text>
      </view>
    </view>

    <scroll-view class="list-container" scroll-y>
      <view class="loading" v-if="loading">
        <text>加载中...</text>
      </view>

      <view class="empty" v-else-if="displayList.length === 0">
        <text class="empty-icon">👥</text>
        <text class="empty-text">{{ currentTab === 'pending' ? '暂无好友请求' : '还没有好友' }}</text>
        <button class="add-btn-large" @click="showAddFriend" v-if="currentTab === 'all'">
          添加好友
        </button>
      </view>

      <view class="friend-item" v-for="friend in displayList" :key="friend.id" @click="viewFriendDetail(friend)">
        <view class="avatar">
          <text>👤</text>
        </view>
        <view class="info">
          <text class="nickname">{{ friend.nickname || friend.friend_did.substring(0, 12) + '...' }}</text>
          <text class="did">DID: {{ friend.friend_did.substring(0, 20) }}...</text>
          <text class="group" v-if="friend.group_name">📁 {{ friend.group_name }}</text>
        </view>
        <view class="status">
          <text class="status-badge" :class="'status-' + friend.status">
            {{ getStatusText(friend.status) }}
          </text>
          <text class="time">{{ formatTime(friend.created_at) }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- 添加好友弹窗 -->
    <view class="modal" v-if="showModal" @click="closeModal">
      <view class="modal-content" @click.stop>
        <text class="modal-title">添加好友</text>

        <view class="modal-form">
          <view class="form-item">
            <text class="label">好友 DID</text>
            <input
              class="input"
              type="text"
              v-model="newFriend.did"
              placeholder="输入好友的 DID 地址"
            />
          </view>

          <view class="form-item">
            <text class="label">备注名称</text>
            <input
              class="input"
              type="text"
              v-model="newFriend.nickname"
              placeholder="给好友起个名字（可选）"
              maxlength="20"
            />
          </view>

          <view class="form-item">
            <text class="label">分组</text>
            <input
              class="input"
              type="text"
              v-model="newFriend.group"
              placeholder="好友、同事、家人...（可选）"
              maxlength="10"
            />
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeModal">取消</button>
          <button class="modal-btn confirm" @click="handleAddFriend" :disabled="!newFriend.did">
            添加
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      searchQuery: '',
      currentTab: 'all',
      friends: [],
      loading: false,
      showModal: false,
      newFriend: {
        did: '',
        nickname: '',
        group: ''
      }
    }
  },
  computed: {
    displayList() {
      let list = this.friends

      // 根据标签页筛选
      if (this.currentTab === 'pending') {
        list = list.filter(f => f.status === 'pending')
      } else if (this.currentTab === 'all') {
        list = list.filter(f => f.status === 'accepted')
      }

      // 搜索筛选
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase()
        list = list.filter(f =>
          (f.nickname && f.nickname.toLowerCase().includes(query)) ||
          f.friend_did.toLowerCase().includes(query) ||
          (f.group_name && f.group_name.toLowerCase().includes(query))
        )
      }

      return list
    },
    pendingCount() {
      return this.friends.filter(f => f.status === 'pending').length
    }
  },
  onLoad() {
    this.loadFriends()
  },
  onPullDownRefresh() {
    this.loadFriends().then(() => {
      uni.stopPullDownRefresh()
    })
  },
  methods: {
    async loadFriends() {
      this.loading = true
      try {
        // 模拟数据加载
        // 实际应该从数据库加载
        await new Promise(resolve => setTimeout(resolve, 500))

        // 模拟一些好友数据
        this.friends = [
          {
            id: 1,
            user_did: 'did:example:user123',
            friend_did: 'did:example:alice456',
            nickname: 'Alice',
            group_name: '好友',
            status: 'accepted',
            created_at: Date.now() - 86400000 * 5
          },
          {
            id: 2,
            user_did: 'did:example:user123',
            friend_did: 'did:example:bob789',
            nickname: 'Bob',
            group_name: '同事',
            status: 'accepted',
            created_at: Date.now() - 86400000 * 3
          },
          {
            id: 3,
            user_did: 'did:example:user123',
            friend_did: 'did:example:charlie123',
            nickname: '',
            group_name: '',
            status: 'pending',
            created_at: Date.now() - 3600000
          }
        ]
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
    handleSearch() {
      // 搜索在 computed 中处理
    },
    switchTab(tab) {
      this.currentTab = tab
    },
    showAddFriend() {
      this.showModal = true
      this.newFriend = { did: '', nickname: '', group: '' }
    },
    closeModal() {
      this.showModal = false
    },
    async handleAddFriend() {
      if (!this.newFriend.did) {
        uni.showToast({
          title: '请输入好友 DID',
          icon: 'none'
        })
        return
      }

      try {
        // 模拟添加好友
        const newFriendData = {
          id: this.friends.length + 1,
          user_did: 'did:example:user123',
          friend_did: this.newFriend.did,
          nickname: this.newFriend.nickname,
          group_name: this.newFriend.group,
          status: 'pending',
          created_at: Date.now()
        }

        this.friends.unshift(newFriendData)

        uni.showToast({
          title: '好友请求已发送',
          icon: 'success'
        })

        this.closeModal()
        this.switchTab('pending')
      } catch (error) {
        console.error('添加好友失败:', error)
        uni.showToast({
          title: '添加失败',
          icon: 'none'
        })
      }
    },
    viewFriendDetail(friend) {
      if (friend.status === 'pending') {
        uni.showModal({
          title: '好友请求',
          content: `接受来自 ${friend.nickname || friend.friend_did} 的好友请求？`,
          cancelText: '拒绝',
          confirmText: '接受',
          success: (res) => {
            if (res.confirm) {
              this.acceptFriend(friend)
            } else if (res.cancel) {
              this.rejectFriend(friend)
            }
          }
        })
      } else {
        uni.showToast({
          title: '好友详情功能开发中',
          icon: 'none'
        })
      }
    },
    acceptFriend(friend) {
      const index = this.friends.findIndex(f => f.id === friend.id)
      if (index !== -1) {
        this.friends[index].status = 'accepted'
        uni.showToast({
          title: '已添加好友',
          icon: 'success'
        })
        this.switchTab('all')
      }
    },
    rejectFriend(friend) {
      this.friends = this.friends.filter(f => f.id !== friend.id)
      uni.showToast({
        title: '已拒绝',
        icon: 'success'
      })
    },
    getStatusText(status) {
      const map = {
        pending: '待验证',
        accepted: '已添加',
        blocked: '已屏蔽'
      }
      return map[status] || status
    },
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`

      return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }
}
</script>

<style lang="scss" scoped>
.friends-container {
  min-height: 100vh;
  background-color: #f8f8f8;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 24rpx;
  background-color: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
  display: flex;
  gap: 20rpx;

  .search-input {
    flex: 1;
    height: 72rpx;
    background-color: #f5f5f5;
    border-radius: 36rpx;
    padding: 0 32rpx;
    font-size: 28rpx;
  }

  .add-btn {
    width: 72rpx;
    height: 72rpx;
    background-color: #3cc51f;
    border-radius: 36rpx;
    font-size: 36rpx;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-btn::after {
    border: none;
  }
}

.tabs {
  display: flex;
  background-color: #ffffff;
  border-bottom: 1rpx solid #f0f0f0;

  .tab-item {
    flex: 1;
    height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28rpx;
    color: #666;
    position: relative;

    &.active {
      color: #3cc51f;
      font-weight: 500;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 60rpx;
        height: 4rpx;
        background-color: #3cc51f;
        border-radius: 2rpx;
      }
    }
  }
}

.list-container {
  flex: 1;
  padding: 24rpx;
}

.loading, .empty {
  padding: 100rpx 40rpx;
  text-align: center;
  color: #999;
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
    margin-bottom: 40rpx;
  }

  .add-btn-large {
    width: 300rpx;
    height: 80rpx;
    background-color: #3cc51f;
    color: #ffffff;
    border-radius: 40rpx;
    font-size: 28rpx;
    border: none;
  }
}

.friend-item {
  background-color: #ffffff;
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
  display: flex;
  gap: 24rpx;
  align-items: center;

  .avatar {
    width: 96rpx;
    height: 96rpx;
    flex-shrink: 0;
    background-color: #e0e0e0;
    border-radius: 48rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48rpx;
  }

  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .nickname {
      font-size: 32rpx;
      font-weight: 500;
      color: #333;
    }

    .did {
      font-size: 24rpx;
      color: #999;
    }

    .group {
      font-size: 24rpx;
      color: #666;
    }
  }

  .status {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8rpx;

    .status-badge {
      padding: 6rpx 16rpx;
      border-radius: 8rpx;
      font-size: 22rpx;

      &.status-pending {
        background-color: #fff7e6;
        color: #fa8c16;
      }

      &.status-accepted {
        background-color: #f6ffed;
        color: #52c41a;
      }

      &.status-blocked {
        background-color: #fff1f0;
        color: #ff4d4f;
      }
    }

    .time {
      font-size: 20rpx;
      color: #999;
    }
  }
}

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
    background-color: #ffffff;
    border-radius: 16rpx;
    padding: 40rpx;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: #333;
      margin-bottom: 32rpx;
      text-align: center;
    }

    .modal-form {
      .form-item {
        margin-bottom: 32rpx;

        .label {
          display: block;
          font-size: 28rpx;
          color: #666;
          margin-bottom: 16rpx;
        }

        .input {
          width: 100%;
          height: 72rpx;
          padding: 0 24rpx;
          background-color: #f5f5f5;
          border-radius: 8rpx;
          font-size: 28rpx;
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: 20rpx;
      margin-top: 40rpx;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 30rpx;
        font-weight: 500;
        border: none;

        &.cancel {
          background-color: #f5f5f5;
          color: #666;
        }

        &.confirm {
          background-color: #3cc51f;
          color: #ffffff;

          &[disabled] {
            opacity: 0.5;
          }
        }
      }

      .modal-btn::after {
        border: none;
      }
    }
  }
}
</style>
