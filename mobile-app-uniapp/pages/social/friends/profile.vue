<template>
  <view class="profile-container">
    <view v-if="loading" class="loading">
      <text>加载中...</text>
    </view>

    <view v-else-if="friend" class="profile-content">
      <!-- 顶部卡片 -->
      <view class="profile-card">
        <view class="avatar">
          <text class="avatar-text">{{ getAvatarText() }}</text>
        </view>

        <view class="profile-info">
          <view class="name-section">
            <text class="nickname">{{ friend.nickname || '未命名好友' }}</text>
            <button class="edit-btn" @click="showEditNickname = true">
              <text class="icon">✏️</text>
            </button>
          </view>

          <text class="did">{{ formatDid(friend.friendDid) }}</text>

          <view class="notes-section" v-if="friend.notes">
            <text class="notes-label">备注：</text>
            <text class="notes-text">{{ friend.notes }}</text>
          </view>

          <text class="friend-since">
            好友时间：{{ formatDate(friend.createdAt) }}
          </text>
        </view>
      </view>

      <!-- DID文档信息 -->
      <view class="did-document-section" v-if="friend.didDocument">
        <view class="section-title">
          <text>DID文档信息</text>
        </view>

        <view class="did-doc-card">
          <view class="doc-item">
            <text class="doc-label">DID:</text>
            <text class="doc-value">{{ friend.didDocument.id }}</text>
          </view>

          <view class="doc-item" v-if="friend.didDocument.verificationMethod">
            <text class="doc-label">验证方法:</text>
            <text class="doc-value">
              {{ friend.didDocument.verificationMethod.length }} 个公钥
            </text>
          </view>

          <view class="doc-item" v-if="friend.didDocument.service">
            <text class="doc-label">服务端点:</text>
            <text class="doc-value">
              {{ friend.didDocument.service.length }} 个端点
            </text>
          </view>
        </view>
      </view>

      <!-- 操作按钮 -->
      <view class="actions-section">
        <button class="action-btn primary" @click="sendMessage">
          <text class="btn-icon">💬</text>
          <text>发送消息</text>
        </button>

        <button class="action-btn" @click="showEditNotes = true">
          <text class="btn-icon">📝</text>
          <text>编辑备注</text>
        </button>

        <button class="action-btn danger" @click="confirmDelete">
          <text class="btn-icon">🗑️</text>
          <text>删除好友</text>
        </button>

        <button class="action-btn danger" @click="confirmBlock">
          <text class="btn-icon">🚫</text>
          <text>拉黑</text>
        </button>
      </view>
    </view>

    <!-- 编辑昵称弹窗 -->
    <view class="modal" v-if="showEditNickname" @click="showEditNickname = false">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">编辑昵称</text>
        </view>

        <view class="modal-body">
          <input
            class="nickname-input"
            type="text"
            v-model="editNickname"
            placeholder="请输入昵称"
            maxlength="20"
          />
          <text class="char-count">{{ editNickname.length }}/20</text>
        </view>

        <view class="modal-footer">
          <button class="modal-btn cancel" @click="showEditNickname = false">
            取消
          </button>
          <button class="modal-btn confirm" @click="saveNickname">
            保存
          </button>
        </view>
      </view>
    </view>

    <!-- 编辑备注弹窗 -->
    <view class="modal" v-if="showEditNotes" @click="showEditNotes = false">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">编辑备注</text>
        </view>

        <view class="modal-body">
          <textarea
            class="notes-textarea"
            v-model="editNotes"
            placeholder="请输入备注信息..."
            maxlength="200"
          />
          <text class="char-count">{{ editNotes.length }}/200</text>
        </view>

        <view class="modal-footer">
          <button class="modal-btn cancel" @click="showEditNotes = false">
            取消
          </button>
          <button class="modal-btn confirm" @click="saveNotes">
            保存
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import friendService from '@/services/friends'

export default {
  data() {
    return {
      did: '',
      friend: null,
      loading: false,
      showEditNickname: false,
      showEditNotes: false,
      editNickname: '',
      editNotes: ''
    }
  },

  onLoad(options) {
    if (options.did) {
      this.did = options.did
      this.loadFriend()
    } else {
      uni.showToast({
        title: '参数错误',
        icon: 'none'
      })
      setTimeout(() => {
        uni.navigateBack()
      }, 1500)
    }
  },

  methods: {
    async loadFriend() {
      this.loading = true

      try {
        await friendService.init()
        const friends = await friendService.getFriends()
        this.friend = friends.find(f => f.friendDid === this.did)

        if (!this.friend) {
          uni.showToast({
            title: '好友不存在',
            icon: 'none'
          })
          setTimeout(() => {
            uni.navigateBack()
          }, 1500)
          return
        }

        // 初始化编辑值
        this.editNickname = this.friend.nickname || ''
        this.editNotes = this.friend.notes || ''
      } catch (error) {
        console.error('加载好友信息失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    async saveNickname() {
      try {
        await friendService.updateFriendInfo(this.did, {
          nickname: this.editNickname.trim()
        })

        uni.showToast({
          title: '保存成功',
          icon: 'success'
        })

        this.showEditNickname = false
        await this.loadFriend()
      } catch (error) {
        console.error('保存昵称失败:', error)
        uni.showToast({
          title: error.message || '保存失败',
          icon: 'none'
        })
      }
    },

    async saveNotes() {
      try {
        await friendService.updateFriendInfo(this.did, {
          notes: this.editNotes.trim()
        })

        uni.showToast({
          title: '保存成功',
          icon: 'success'
        })

        this.showEditNotes = false
        await this.loadFriend()
      } catch (error) {
        console.error('保存备注失败:', error)
        uni.showToast({
          title: error.message || '保存失败',
          icon: 'none'
        })
      }
    },

    sendMessage() {
      uni.navigateTo({
        url: `/pages/social/chat/conversation?did=${this.did}`
      })
    },

    confirmDelete() {
      uni.showModal({
        title: '删除好友',
        content: '确定要删除该好友吗？',
        confirmText: '删除',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            await this.deleteFriend()
          }
        }
      })
    },

    async deleteFriend() {
      try {
        await friendService.removeFriend(this.did)

        uni.showToast({
          title: '已删除',
          icon: 'success'
        })

        setTimeout(() => {
          uni.navigateBack()
        }, 1500)
      } catch (error) {
        console.error('删除好友失败:', error)
        uni.showToast({
          title: error.message || '删除失败',
          icon: 'none'
        })
      }
    },

    confirmBlock() {
      uni.showModal({
        title: '拉黑用户',
        content: '拉黑后将删除好友关系，且无法再添加该用户。确定继续吗？',
        confirmText: '拉黑',
        confirmColor: '#ff4d4f',
        editable: true,
        placeholderText: '可选：输入拉黑原因',
        success: async (res) => {
          if (res.confirm) {
            await this.blockUser(res.content || '')
          }
        }
      })
    },

    async blockUser(reason) {
      try {
        await friendService.blockUser(this.did, reason)

        uni.showToast({
          title: '已拉黑',
          icon: 'success'
        })

        setTimeout(() => {
          uni.navigateBack()
        }, 1500)
      } catch (error) {
        console.error('拉黑用户失败:', error)
        uni.showToast({
          title: error.message || '操作失败',
          icon: 'none'
        })
      }
    },

    getAvatarText() {
      if (this.friend?.nickname) {
        return this.friend.nickname.substring(0, 2)
      }
      return this.did.slice(-2).toUpperCase()
    },

    formatDid(did) {
      if (!did || did.length <= 32) {
        return did
      }
      return `${did.substring(0, 24)}...${did.slice(-8)}`
    },

    formatDate(timestamp) {
      const date = new Date(timestamp)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
  }
}
</script>

<style lang="scss" scoped>
.profile-container {
  min-height: 100vh;
  background: var(--bg-primary);
  padding: 32rpx;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 120rpx;
  color: var(--text-secondary);
}

.profile-card {
  background: var(--bg-card);
  border-radius: 16rpx;
  padding: 48rpx 32rpx;
  margin-bottom: 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;

  .avatar {
    width: 160rpx;
    height: 160rpx;
    border-radius: 80rpx;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 32rpx;

    .avatar-text {
      font-size: 64rpx;
      font-weight: bold;
      color: white;
    }
  }

  .profile-info {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16rpx;

    .name-section {
      display: flex;
      align-items: center;
      gap: 16rpx;

      .nickname {
        font-size: 40rpx;
        font-weight: bold;
        color: var(--text-primary);
      }

      .edit-btn {
        width: 56rpx;
        height: 56rpx;
        background: var(--bg-secondary);
        border: none;
        border-radius: 28rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;

        &::after {
          border: none;
        }

        .icon {
          font-size: 28rpx;
        }
      }
    }

    .did {
      font-size: 24rpx;
      color: var(--text-tertiary);
      font-family: monospace;
    }

    .notes-section {
      width: 100%;
      background: var(--bg-secondary);
      border-radius: 12rpx;
      padding: 16rpx 24rpx;
      margin-top: 8rpx;

      .notes-label {
        font-size: 22rpx;
        color: var(--text-tertiary);
      }

      .notes-text {
        font-size: 26rpx;
        color: var(--text-secondary);
        margin-left: 8rpx;
      }
    }

    .friend-since {
      font-size: 22rpx;
      color: var(--text-tertiary);
      margin-top: 8rpx;
    }
  }
}

.did-document-section {
  background: var(--bg-card);
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 32rpx;

  .section-title {
    font-size: 32rpx;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 24rpx;
  }

  .did-doc-card {
    .doc-item {
      padding: 16rpx 0;
      border-bottom: 1rpx solid var(--border-color);

      &:last-child {
        border-bottom: none;
      }

      .doc-label {
        display: block;
        font-size: 24rpx;
        color: var(--text-tertiary);
        margin-bottom: 8rpx;
      }

      .doc-value {
        display: block;
        font-size: 26rpx;
        color: var(--text-secondary);
        word-break: break-all;
      }
    }
  }
}

.actions-section {
  display: flex;
  flex-direction: column;
  gap: 16rpx;

  .action-btn {
    height: 88rpx;
    background: var(--bg-card);
    color: var(--text-primary);
    border: none;
    border-radius: 16rpx;
    font-size: 30rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16rpx;

    &::after {
      border: none;
    }

    &.primary {
      background: var(--bg-accent);
      color: var(--text-on-accent);
      font-weight: bold;
    }

    &.danger {
      color: var(--color-error);
    }

    .btn-icon {
      font-size: 32rpx;
    }
  }
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 600rpx;
    background: var(--bg-card);
    border-radius: 16rpx;
    overflow: hidden;

    .modal-header {
      padding: 32rpx;
      border-bottom: 1rpx solid var(--border-color);

      .modal-title {
        font-size: 32rpx;
        font-weight: bold;
        color: var(--text-primary);
      }
    }

    .modal-body {
      padding: 32rpx;

      .nickname-input,
      .notes-textarea {
        width: 100%;
        background: var(--bg-secondary);
        border-radius: 12rpx;
        padding: 20rpx;
        font-size: 28rpx;
        color: var(--text-primary);
      }

      .notes-textarea {
        min-height: 200rpx;
      }

      .char-count {
        display: block;
        text-align: right;
        font-size: 22rpx;
        color: var(--text-tertiary);
        margin-top: 8rpx;
      }
    }

    .modal-footer {
      display: flex;
      border-top: 1rpx solid var(--border-color);

      .modal-btn {
        flex: 1;
        height: 88rpx;
        background: transparent;
        border: none;
        font-size: 30rpx;

        &::after {
          border: none;
        }

        &.cancel {
          color: var(--text-secondary);
          border-right: 1rpx solid var(--border-color);
        }

        &.confirm {
          color: var(--text-link);
          font-weight: bold;
        }
      }
    }
  }
}
</style>
