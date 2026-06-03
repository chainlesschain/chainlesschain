<template>
  <view class="create-post-container">
    <!-- 头部 -->
    <view class="header">
      <button class="cancel-btn" @click="handleCancel">
        <text>取消</text>
      </button>
      <text class="title">发布动态</text>
      <button
        class="publish-btn"
        :class="{ 'btn-disabled': !canPublish }"
        :disabled="!canPublish || publishing"
        @click="handlePublish"
      >
        <text v-if="!publishing">发布</text>
        <text v-else>发布中...</text>
      </button>
    </view>

    <!-- 内容编辑区 -->
    <scroll-view class="content-area" scroll-y>
      <textarea
        class="content-input"
        v-model="content"
        placeholder="分享新鲜事... (支持 @好友 和 #话题#)"
        :maxlength="maxLength"
        auto-height
        :disabled="publishing"
        @input="handleContentInput"
      />

      <!-- @提及建议列表 -->
      <view class="mention-suggestions" v-if="showMentionSuggestions">
        <view
          class="suggestion-item"
          v-for="friend in mentionSuggestions"
          :key="friend.did"
          @click="selectMention(friend)"
        >
          <view class="friend-avatar">
            <text>{{ getFriendAvatar(friend) }}</text>
          </view>
          <text class="friend-name">{{ getFriendName(friend) }}</text>
        </view>
      </view>

      <view class="char-count">
        <text>{{ content.length }}/{{ maxLength }}</text>
      </view>

      <!-- 提取的标签和提及 -->
      <view class="tags-section" v-if="extractedHashtags.length > 0 || extractedMentions.length > 0">
        <view class="tags-row" v-if="extractedHashtags.length > 0">
          <text class="tag-label">话题:</text>
          <view class="tag-list">
            <text
              class="tag-item"
              v-for="(tag, index) in extractedHashtags"
              :key="index"
            >
              #{{ tag }}
            </text>
          </view>
        </view>
        <view class="tags-row" v-if="extractedMentions.length > 0">
          <text class="tag-label">提及:</text>
          <view class="tag-list">
            <text
              class="tag-item"
              v-for="(mention, index) in extractedMentions"
              :key="index"
            >
              @{{ mention.name }}
            </text>
          </view>
        </view>
      </view>

      <!-- 图片选择区域 -->
      <view class="images-section" v-if="images.length > 0">
        <view class="image-list">
          <view
            class="image-item"
            v-for="(img, index) in images"
            :key="index"
          >
            <image class="image" :src="img" mode="aspectFill" />
            <view class="remove-btn" @click="removeImage(index)">
              <text>✕</text>
            </view>
          </view>

          <view class="add-image-btn" v-if="images.length < maxImages" @click="addImage">
            <text class="add-icon">+</text>
          </view>
        </view>
      </view>

      <view class="add-image-placeholder" v-else @click="addImage">
        <text class="add-icon">📷</text>
        <text class="add-text">添加图片（最多{{ maxImages }}张）</text>
      </view>
    </scroll-view>

    <!-- 底部工具栏 -->
    <view class="toolbar">
      <view class="visibility-selector">
        <text class="label">可见范围：</text>
        <picker
          mode="selector"
          :range="visibilityOptions"
          range-key="label"
          :value="visibilityIndex"
          @change="handleVisibilityChange"
        >
          <view class="picker-content">
            <text>{{ visibilityOptions[visibilityIndex].label }}</text>
            <text class="dropdown-icon">▼</text>
          </view>
        </picker>
      </view>
    </view>
  </view>
</template>

<script>
import postsService from '@/services/posts'
import friendService from '@/services/friends'

export default {
  data() {
    return {
      content: '',
      images: [],
      maxLength: 2000,
      maxImages: 9,
      publishing: false,
      visibilityIndex: 1, // 默认好友可见
      visibilityOptions: [
        { value: 'public', label: '🌍 公开' },
        { value: 'friends', label: '👥 好友可见' },
        { value: 'private', label: '🔒 仅自己可见' }
      ],
      // @提及功能
      friends: [],
      showMentionSuggestions: false,
      mentionSuggestions: [],
      mentionSearchQuery: '',
      cursorPosition: 0,
      // 提取的标签和提及
      extractedHashtags: [],
      extractedMentions: []
    }
  },

  computed: {
    canPublish() {
      return this.content.trim().length > 0 || this.images.length > 0
    },

    selectedVisibility() {
      return this.visibilityOptions[this.visibilityIndex].value
    }
  },

  async onLoad() {
    await this.loadFriends()
  },

  methods: {
    async loadFriends() {
      try {
        await friendService.init()
        this.friends = await friendService.getFriends()
      } catch (error) {
        console.error('加载好友列表失败:', error)
      }
    },

    handleContentInput(e) {
      const content = e.detail.value
      this.content = content

      // 检测 @ 符号
      const atIndex = content.lastIndexOf('@')
      if (atIndex !== -1) {
        const afterAt = content.substring(atIndex + 1)
        // 如果 @ 后面没有空格，显示建议
        if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
          this.mentionSearchQuery = afterAt
          this.showMentionSuggestions = true
          this.updateMentionSuggestions()
        } else {
          this.showMentionSuggestions = false
        }
      } else {
        this.showMentionSuggestions = false
      }

      // 提取话题标签和提及
      this.extractTagsAndMentions()
    },

    updateMentionSuggestions() {
      if (!this.mentionSearchQuery) {
        this.mentionSuggestions = this.friends.slice(0, 5)
      } else {
        const query = this.mentionSearchQuery.toLowerCase()
        this.mentionSuggestions = this.friends
          .filter(friend => {
            const name = this.getFriendName(friend).toLowerCase()
            return name.includes(query)
          })
          .slice(0, 5)
      }
    },

    selectMention(friend) {
      const atIndex = this.content.lastIndexOf('@')
      if (atIndex !== -1) {
        const beforeAt = this.content.substring(0, atIndex)
        const afterAt = this.content.substring(atIndex + 1)
        const afterSpace = afterAt.indexOf(' ')
        const afterNewline = afterAt.indexOf('\n')

        let endIndex = afterAt.length
        if (afterSpace !== -1) endIndex = Math.min(endIndex, afterSpace)
        if (afterNewline !== -1) endIndex = Math.min(endIndex, afterNewline)

        const after = afterAt.substring(endIndex)
        const friendName = this.getFriendName(friend)

        this.content = `${beforeAt}@${friendName} ${after}`
      }

      this.showMentionSuggestions = false
      this.extractTagsAndMentions()
    },

    extractTagsAndMentions() {
      // 提取话题标签 #话题#
      const hashtagRegex = /#([^#\s]+)#/g
      const hashtags = []
      let match
      while ((match = hashtagRegex.exec(this.content)) !== null) {
        hashtags.push(match[1])
      }
      this.extractedHashtags = [...new Set(hashtags)]

      // 提取 @提及
      const mentionRegex = /@([^\s@]+)/g
      const mentions = []
      while ((match = mentionRegex.exec(this.content)) !== null) {
        const mentionName = match[1]
        const friend = this.friends.find(f =>
          this.getFriendName(f) === mentionName
        )
        if (friend) {
          mentions.push({
            name: mentionName,
            did: friend.did
          })
        }
      }
      this.extractedMentions = mentions
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
    },
    handleVisibilityChange(e) {
      this.visibilityIndex = e.detail.value
    },

    addImage() {
      // #ifdef APP-PLUS
      uni.chooseImage({
        count: this.maxImages - this.images.length,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.images.push(...res.tempFilePaths)
        },
        fail: (err) => {
          console.error('选择图片失败:', err)
          uni.showToast({
            title: '选择图片失败',
            icon: 'none'
          })
        }
      })
      // #endif

      // #ifdef H5
      // H5模式下简化处理
      uni.showToast({
        title: 'H5模式暂不支持上传图片',
        icon: 'none'
      })
      // #endif
    },

    removeImage(index) {
      this.images.splice(index, 1)
    },

    async handlePublish() {
      if (!this.canPublish || this.publishing) {
        return
      }

      this.publishing = true

      try {
        await postsService.createPost({
          content: this.content.trim(),
          images: this.images,
          visibility: this.selectedVisibility,
          hashtags: this.extractedHashtags,
          mentions: this.extractedMentions.map(m => m.did)
        })

        uni.showToast({
          title: '发布成功',
          icon: 'success'
        })

        // 延迟返回
        setTimeout(() => {
          uni.navigateBack()
        }, 1000)
      } catch (error) {
        console.error('发布失败:', error)

        let errorMsg = '发布失败'
        if (error.message) {
          errorMsg = error.message
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.publishing = false
      }
    },

    handleCancel() {
      if (this.content.trim().length > 0 || this.images.length > 0) {
        uni.showModal({
          title: '确认取消',
          content: '确定要放弃编辑吗？',
          success: (res) => {
            if (res.confirm) {
              uni.navigateBack()
            }
          }
        })
      } else {
        uni.navigateBack()
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.create-post-container {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--bg-card);
  border-bottom: 2rpx solid var(--border-color);
  padding: 24rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .cancel-btn {
    background: transparent;
    color: var(--text-secondary);
    border: none;
    font-size: 28rpx;
    padding: 0;

    &::after {
      border: none;
    }
  }

  .title {
    font-size: 32rpx;
    font-weight: bold;
    color: var(--text-primary);
  }

  .publish-btn {
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 24rpx;
    padding: 8rpx 24rpx;
    font-size: 28rpx;

    &.btn-disabled {
      opacity: 0.5;
    }

    &::after {
      border: none;
    }
  }
}

.content-area {
  flex: 1;
  padding: 32rpx;
}

.content-input {
  width: 100%;
  min-height: 400rpx;
  background: transparent;
  font-size: 28rpx;
  color: var(--text-primary);
  line-height: 1.6;
}

.mention-suggestions {
  background: var(--bg-card);
  border-radius: 12rpx;
  margin-top: 16rpx;
  padding: 16rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.1);
  max-height: 400rpx;
  overflow-y: auto;

  .suggestion-item {
    display: flex;
    align-items: center;
    padding: 16rpx;
    border-radius: 8rpx;

    &:active {
      background: var(--bg-secondary);
    }

    .friend-avatar {
      width: 64rpx;
      height: 64rpx;
      border-radius: 32rpx;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 16rpx;
      font-size: 24rpx;
      font-weight: bold;
      color: white;
    }

    .friend-name {
      font-size: 26rpx;
      color: var(--text-primary);
    }
  }
}

.tags-section {
  margin-top: 24rpx;
  padding: 16rpx;
  background: var(--bg-secondary);
  border-radius: 12rpx;

  .tags-row {
    display: flex;
    align-items: flex-start;
    margin-bottom: 12rpx;

    &:last-child {
      margin-bottom: 0;
    }

    .tag-label {
      font-size: 24rpx;
      color: var(--text-secondary);
      margin-right: 12rpx;
      flex-shrink: 0;
    }

    .tag-list {
      flex: 1;
      display: flex;
      flex-wrap: wrap;
      gap: 8rpx;

      .tag-item {
        font-size: 22rpx;
        color: var(--bg-accent);
        background: var(--bg-accent-light);
        padding: 4rpx 12rpx;
        border-radius: 12rpx;
      }
    }
  }
}

.char-count {
  text-align: right;
  font-size: 22rpx;
  color: var(--text-tertiary);
  margin-top: 16rpx;
}

.images-section {
  margin-top: 32rpx;

  .image-list {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16rpx;

    .image-item {
      position: relative;
      width: 100%;
      padding-bottom: 100%;

      .image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 12rpx;
      }

      .remove-btn {
        position: absolute;
        top: 8rpx;
        right: 8rpx;
        width: 48rpx;
        height: 48rpx;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 24rpx;
        display: flex;
        align-items: center;
        justify-content: center;

        text {
          color: white;
          font-size: 28rpx;
        }
      }
    }

    .add-image-btn {
      width: 100%;
      padding-bottom: 100%;
      background: var(--bg-secondary);
      border-radius: 12rpx;
      border: 2rpx dashed var(--border-color);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;

      .add-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 64rpx;
        color: var(--text-tertiary);
      }
    }
  }
}

.add-image-placeholder {
  margin-top: 32rpx;
  padding: 80rpx 32rpx;
  background: var(--bg-secondary);
  border-radius: 16rpx;
  border: 2rpx dashed var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;

  .add-icon {
    font-size: 64rpx;
  }

  .add-text {
    font-size: 24rpx;
    color: var(--text-tertiary);
  }
}

.toolbar {
  background: var(--bg-card);
  border-top: 2rpx solid var(--border-color);
  padding: 24rpx 32rpx;

  .visibility-selector {
    display: flex;
    align-items: center;
    gap: 16rpx;

    .label {
      font-size: 26rpx;
      color: var(--text-secondary);
    }

    .picker-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12rpx 24rpx;
      background: var(--bg-secondary);
      border-radius: 24rpx;
      font-size: 26rpx;
      color: var(--text-primary);

      .dropdown-icon {
        font-size: 20rpx;
        color: var(--text-tertiary);
      }
    }
  }
}
</style>
