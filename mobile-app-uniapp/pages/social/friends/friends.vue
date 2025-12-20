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
        <text>全部好友 ({{ acceptedCount }})</text>
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

      <view class="friend-item" v-for="friend in displayList" :key="friend.friend_did">
        <view class="avatar" @click="handleFriendAction(friend)">
          <text>👤</text>
        </view>
        <view class="info" @click="handleFriendAction(friend)">
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
        <view class="more" @click="showFriendMenu(friend)" v-if="friend.status === 'accepted'">
          <text>⋯</text>
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
import { db } from '@/services/database'

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
      },
      myDid: ''
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
    acceptedCount() {
      return this.friends.filter(f => f.status === 'accepted').length
    },
    pendingCount() {
      return this.friends.filter(f => f.status === 'pending').length
    }
  },
  onLoad() {
    this.initUserDid()
    this.loadFriends()
  },
  onShow() {
    // 每次显示时刷新好友列表
    this.loadFriends()
  },
  onPullDownRefresh() {
    this.loadFriends().then(() => {
      uni.stopPullDownRefresh()
    })
  },
  methods: {
    /**
     * 初始化用户DID
     */
    initUserDid() {
      this.myDid = uni.getStorageSync('device_id') || 'did:chainless:user123'
    },

    /**
     * 加载好友列表
     */
    async loadFriends() {
      this.loading = true
      try {
        const friends = await db.getFriends('all')
        this.friends = friends
        console.log('加载好友列表:', friends.length)
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

    /**
     * 搜索处理
     */
    handleSearch() {
      // 搜索在 computed 中处理
    },

    /**
     * 切换标签
     */
    switchTab(tab) {
      this.currentTab = tab
    },

    /**
     * 显示添加好友弹窗
     */
    showAddFriend() {
      this.showModal = true
      this.newFriend = { did: '', nickname: '', group: '' }
    },

    /**
     * 关闭弹窗
     */
    closeModal() {
      this.showModal = false
    },

    /**
     * 添加好友
     */
    async handleAddFriend() {
      if (!this.newFriend.did) {
        uni.showToast({
          title: '请输入好友 DID',
          icon: 'none'
        })
        return
      }

      // 验证DID格式（简单验证）
      if (!this.newFriend.did.startsWith('did:')) {
        uni.showToast({
          title: 'DID格式不正确',
          icon: 'none'
        })
        return
      }

      // 不能添加自己
      if (this.newFriend.did === this.myDid) {
        uni.showToast({
          title: '不能添加自己为好友',
          icon: 'none'
        })
        return
      }

      try {
        await db.addFriend(
          this.myDid,
          this.newFriend.did,
          this.newFriend.nickname,
          this.newFriend.group
        )

        uni.showToast({
          title: '好友请求已发送',
          icon: 'success'
        })

        this.closeModal()

        // 刷新列表
        await this.loadFriends()

        // 切换到待验证标签
        this.switchTab('pending')
      } catch (error) {
        console.error('添加好友失败:', error)
        uni.showToast({
          title: error.message || '添加失败',
          icon: 'none'
        })
      }
    },

    /**
     * 好友操作（点击好友）
     */
    handleFriendAction(friend) {
      if (friend.status === 'pending') {
        // 待验证好友，显示接受/拒绝对话框
        uni.showModal({
          title: '好友请求',
          content: `接受来自 ${friend.nickname || friend.friend_did.substring(0, 20)} 的好友请求？`,
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
      } else if (friend.status === 'accepted') {
        // 已接受好友，跳转到聊天页面
        uni.navigateTo({
          url: `/pages/social/friend-chat/friend-chat?friendDid=${friend.friend_did}&nickname=${encodeURIComponent(friend.nickname || friend.friend_did)}`
        })
      }
    },

    /**
     * 接受好友请求
     */
    async acceptFriend(friend) {
      try {
        await db.updateFriendStatus(this.myDid, friend.friend_did, 'accepted')

        uni.showToast({
          title: '已添加好友',
          icon: 'success'
        })

        // 刷新列表
        await this.loadFriends()

        // 切换到全部好友标签
        this.switchTab('all')
      } catch (error) {
        console.error('接受好友失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    /**
     * 拒绝好友请求
     */
    async rejectFriend(friend) {
      try {
        await db.deleteFriend(this.myDid, friend.friend_did)

        uni.showToast({
          title: '已拒绝',
          icon: 'success'
        })

        // 刷新列表
        await this.loadFriends()
      } catch (error) {
        console.error('拒绝好友失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    /**
     * 显示好友菜单
     */
    showFriendMenu(friend) {
      uni.showActionSheet({
        itemList: ['发送消息', '编辑备注', '删除好友'],
        success: (res) => {
          const index = res.tapIndex
          if (index === 0) {
            this.sendMessage(friend)
          } else if (index === 1) {
            this.editFriend(friend)
          } else if (index === 2) {
            this.deleteFriendConfirm(friend)
          }
        }
      })
    },

    /**
     * 发送消息
     */
    sendMessage(friend) {
      uni.navigateTo({
        url: `/pages/social/friend-chat/friend-chat?friendDid=${friend.friend_did}&nickname=${encodeURIComponent(friend.nickname || friend.friend_did)}`
      })
    },

    /**
     * 编辑好友
     */
    editFriend(friend) {
      uni.showModal({
        title: '编辑备注',
        editable: true,
        placeholderText: friend.nickname || '输入备注名称',
        success: async (res) => {
          if (res.confirm && res.content) {
            try {
              await db.updateFriend(this.myDid, friend.friend_did, {
                nickname: res.content
              })

              uni.showToast({
                title: '修改成功',
                icon: 'success'
              })

              // 刷新列表
              await this.loadFriends()
            } catch (error) {
              console.error('修改备注失败:', error)
              uni.showToast({
                title: '修改失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    /**
     * 删除好友确认
     */
    deleteFriendConfirm(friend) {
      uni.showModal({
        title: '删除好友',
        content: `确定要删除好友 ${friend.nickname || friend.friend_did.substring(0, 20)} 吗？`,
        confirmColor: 'var(--color-error)',
        success: async (res) => {
          if (res.confirm) {
            await this.deleteFriendAction(friend)
          }
        }
      })
    },

    /**
     * 删除好友操作
     */
    async deleteFriendAction(friend) {
      try {
        await db.deleteFriend(this.myDid, friend.friend_did)

        uni.showToast({
          title: '已删除',
          icon: 'success'
        })

        // 刷新列表
        await this.loadFriends()
      } catch (error) {
        console.error('删除好友失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    /**
     * 获取状态文本
     */
    getStatusText(status) {
      const map = {
        pending: '待验证',
        accepted: '已添加',
        blocked: '已屏蔽'
      }
      return map[status] || status
    },

    /**
     * 格式化时间
     */
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
  background-color: var(--bg-page);
  display: flex;
  flex-direction: column;
}

.header {
  padding: 24rpx;
  background-color: var(--bg-card);
  box-shadow: 0 2rpx 8rpx var(--shadow-sm);
  display: flex;
  gap: 20rpx;

  .search-input {
    flex: 1;
    height: 72rpx;
    background-color: var(--bg-input);
    border-radius: 36rpx;
    padding: 0 32rpx;
    font-size: 28rpx;
  }

  .add-btn {
    width: 72rpx;
    height: 72rpx;
    background-color: var(--color-primary);
    border-radius: 36rpx;
    font-size: 36rpx;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bg-card);
  }

  .add-btn::after {
    border: none;
  }
}

.tabs {
  display: flex;
  background-color: var(--bg-card);
  border-bottom: 1rpx solid var(--bg-hover);

  .tab-item {
    flex: 1;
    height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28rpx;
    color: var(--text-secondary);
    position: relative;

    &.active {
      color: var(--color-primary);
      font-weight: 500;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 60rpx;
        height: 4rpx;
        background-color: var(--color-primary);
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
    margin-bottom: 40rpx;
  }

  .add-btn-large {
    width: 300rpx;
    height: 80rpx;
    background-color: var(--color-primary);
    color: var(--bg-card);
    border-radius: 40rpx;
    font-size: 28rpx;
    border: none;

    &::after {
      border: none;
    }
  }
}

.friend-item {
  background-color: var(--bg-card);
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
      color: var(--text-primary);
    }

    .did {
      font-size: 24rpx;
      color: var(--text-tertiary);
    }

    .group {
      font-size: 24rpx;
      color: var(--text-secondary);
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
        color: var(--color-warning);
      }

      &.status-accepted {
        background-color: #f6ffed;
        color: var(--color-success);
      }

      &.status-blocked {
        background-color: #fff1f0;
        color: var(--color-error);
      }
    }

    .time {
      font-size: 20rpx;
      color: var(--text-tertiary);
    }
  }

  .more {
    width: 64rpx;
    height: 64rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 40rpx;
    color: var(--text-tertiary);
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
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 40rpx;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .modal-form {
      .form-item {
        margin-bottom: 32rpx;

        .label {
          display: block;
          font-size: 28rpx;
          color: var(--text-secondary);
          margin-bottom: 16rpx;
        }

        .input {
          width: 100%;
          height: 72rpx;
          padding: 0 24rpx;
          background-color: var(--bg-input);
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
          background-color: var(--bg-input);
          color: var(--text-secondary);
        }

        &.confirm {
          background-color: var(--color-primary);
          color: var(--bg-card);

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
