<template>
  <view class="create-group-container">
    <view class="header">
      <button class="back-btn" @click="goBack">取消</button>
      <text class="title">创建群聊</text>
      <button class="save-btn" @click="createGroup" :disabled="!canCreate">完成</button>
    </view>

    <scroll-view class="content" scroll-y>
      <!-- 群信息 -->
      <view class="section">
        <view class="section-title">群信息</view>
        <view class="form-item">
          <text class="label">群名称</text>
          <input
            class="input"
            v-model="groupName"
            placeholder="请输入群名称"
            maxlength="30"
          />
        </view>
        <view class="form-item">
          <text class="label">群简介</text>
          <textarea
            class="textarea"
            v-model="groupDescription"
            placeholder="请输入群简介（可选）"
            maxlength="200"
          />
        </view>
      </view>

      <!-- 选择成员 -->
      <view class="section">
        <view class="section-header">
          <text class="section-title">选择成员</text>
          <text class="member-count">已选 {{ selectedMembers.length }} 人</text>
        </view>

        <view class="search-box">
          <input
            class="search-input"
            v-model="searchQuery"
            placeholder="搜索好友"
            @input="onSearch"
          />
        </view>

        <view v-if="loadingFriends" class="loading">
          <text>加载中...</text>
        </view>

        <view v-else-if="filteredFriends.length === 0" class="empty">
          <text>没有找到好友</text>
        </view>

        <view v-else class="friends-list">
          <view
            class="friend-item"
            v-for="friend in filteredFriends"
            :key="friend.did"
            :class="{ selected: selectedMembers.includes(friend.did) }"
            @click="toggleMember(friend)"
          >
            <view class="friend-avatar">
              <text class="avatar-text">{{ getFriendAvatar(friend) }}</text>
            </view>
            <view class="friend-info">
              <text class="friend-name">{{ getFriendName(friend) }}</text>
            </view>
            <view class="checkbox">
              <text v-if="selectedMembers.includes(friend.did)">✓</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 群设置 -->
      <view class="section">
        <view class="section-title">群设置</view>
        <view class="setting-item">
          <text class="setting-label">允许成员邀请</text>
          <switch
            :checked="allowMemberInvite"
            @change="allowMemberInvite = $event.detail.value"
          />
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import friendService from '@/services/friends'
import groupChatService from '@/services/group-chat'

export default {
  data() {
    return {
      groupName: '',
      groupDescription: '',
      friends: [],
      filteredFriends: [],
      selectedMembers: [],
      searchQuery: '',
      loadingFriends: false,
      allowMemberInvite: true
    }
  },

  computed: {
    canCreate() {
      return this.groupName.trim().length > 0 && this.selectedMembers.length > 0
    }
  },

  onLoad() {
    this.loadFriends()
  },

  methods: {
    async loadFriends() {
      this.loadingFriends = true
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
        this.loadingFriends = false
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

    toggleMember(friend) {
      const index = this.selectedMembers.indexOf(friend.did)
      if (index > -1) {
        this.selectedMembers.splice(index, 1)
      } else {
        this.selectedMembers.push(friend.did)
      }
    },

    async createGroup() {
      if (!this.canCreate) {
        return
      }

      try {
        uni.showLoading({ title: '创建中...' })

        await groupChatService.init()
        const group = await groupChatService.createGroup({
          name: this.groupName.trim(),
          description: this.groupDescription.trim(),
          members: this.selectedMembers,
          allowMemberInvite: this.allowMemberInvite
        })

        uni.hideLoading()
        uni.showToast({
          title: '创建成功',
          icon: 'success'
        })

        setTimeout(() => {
          uni.redirectTo({
            url: `/pages/social/groups/chat?groupId=${group.id}`
          })
        }, 1500)
      } catch (error) {
        uni.hideLoading()
        console.error('创建群聊失败:', error)
        uni.showToast({
          title: error.message || '创建失败',
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
.create-group-container {
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

  .back-btn,
  .save-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 28rpx;
    padding: 0;

    &::after {
      border: none;
    }
  }

  .save-btn {
    color: var(--bg-accent);

    &[disabled] {
      opacity: 0.5;
    }
  }
}

.content {
  flex: 1;
}

.section {
  background: var(--bg-card);
  margin-bottom: 16rpx;
  padding: 32rpx;

  .section-title {
    font-size: 28rpx;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 24rpx;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24rpx;

    .member-count {
      font-size: 24rpx;
      color: var(--text-tertiary);
    }
  }
}

.form-item {
  margin-bottom: 24rpx;

  &:last-child {
    margin-bottom: 0;
  }

  .label {
    display: block;
    font-size: 26rpx;
    color: var(--text-secondary);
    margin-bottom: 12rpx;
  }

  .input,
  .textarea {
    width: 100%;
    background: var(--bg-secondary);
    border-radius: 12rpx;
    padding: 16rpx 24rpx;
    font-size: 28rpx;
    color: var(--text-primary);
    border: 1rpx solid var(--border-color);
  }

  .textarea {
    min-height: 120rpx;
  }
}

.search-box {
  margin-bottom: 24rpx;

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

.loading,
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  font-size: 26rpx;
  color: var(--text-secondary);
}

.friends-list {
  max-height: 600rpx;
  overflow-y: auto;
}

.friend-item {
  display: flex;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 1rpx solid var(--border-color);

  &:last-child {
    border-bottom: none;
  }

  &.selected {
    background: var(--bg-accent-light);
    margin: 0 -32rpx;
    padding-left: 32rpx;
    padding-right: 32rpx;
  }

  .friend-avatar {
    width: 72rpx;
    height: 72rpx;
    border-radius: 36rpx;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 16rpx;

    .avatar-text {
      font-size: 28rpx;
      font-weight: bold;
      color: white;
    }
  }

  .friend-info {
    flex: 1;

    .friend-name {
      font-size: 28rpx;
      color: var(--text-primary);
    }
  }

  .checkbox {
    width: 40rpx;
    height: 40rpx;
    border: 2rpx solid var(--border-color);
    border-radius: 20rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28rpx;
    color: var(--color-success);
  }

  &.selected .checkbox {
    background: var(--color-success);
    border-color: var(--color-success);
    color: white;
  }
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;

  .setting-label {
    font-size: 28rpx;
    color: var(--text-primary);
  }
}
</style>
