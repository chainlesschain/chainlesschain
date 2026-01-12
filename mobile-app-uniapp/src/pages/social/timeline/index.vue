<template>
  <view class="timeline-container">
    <!-- 头部 -->
    <view class="header">
      <text class="title">动态</text>
      <button class="create-btn" @click="goToCreate">
        <text class="icon">✏️</text>
      </button>
    </view>

    <!-- 动态列表 -->
    <scroll-view
      class="posts-list"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="loading">
        <text>加载中...</text>
      </view>

      <view v-else-if="posts.length === 0" class="empty">
        <text class="empty-icon">📝</text>
        <text class="empty-text">还没有动态</text>
        <button class="create-post-btn" @click="goToCreate">
          发布第一条动态
        </button>
      </view>

      <view v-else class="posts">
        <view
          class="post-item"
          v-for="post in posts"
          :key="post.id"
          @click="goToPostDetail(post)"
        >
          <!-- 发布者信息 -->
          <view class="post-header">
            <view class="author-avatar">
              <text class="avatar-text">{{ getAuthorAvatar(post) }}</text>
            </view>
            <view class="author-info">
              <text class="author-name">{{ getAuthorName(post) }}</text>
              <text class="post-time">{{ formatTime(post.createdAt) }}</text>
            </view>
            <view class="post-privacy">
              <text class="privacy-icon">{{ getPrivacyIcon(post.visibility) }}</text>
            </view>
          </view>

          <!-- 动态内容 -->
          <view class="post-content">
            <text class="content-text">{{ post.content }}</text>
          </view>

          <!-- 图片（如果有） -->
          <view class="post-images" v-if="post.images && post.images.length > 0">
            <image
              v-for="(img, index) in post.images.slice(0, 9)"
              :key="index"
              class="post-image"
              :src="img"
              mode="aspectFill"
            />
          </view>

          <!-- 互动区域 -->
          <view class="post-actions">
            <view
              class="action-item"
              :class="{ active: post.isLiked }"
              @click.stop="toggleLike(post)"
            >
              <text class="action-icon">{{ post.isLiked ? '❤️' : '🤍' }}</text>
              <text class="action-text">{{ post.likeCount || 0 }}</text>
            </view>

            <view class="action-item" @click.stop="goToPostDetail(post)">
              <text class="action-icon">💬</text>
              <text class="action-text">{{ post.commentCount || 0 }}</text>
            </view>

            <view class="action-item" @click.stop="sharePost(post)">
              <text class="action-icon">🔗</text>
              <text class="action-text">分享</text>
            </view>
          </view>

          <!-- 评论预览 -->
          <view class="comments-preview" v-if="post.comments && post.comments.length > 0">
            <view
              class="comment-item"
              v-for="comment in post.comments.slice(0, 2)"
              :key="comment.id"
            >
              <text class="comment-author">{{ getCommentAuthor(comment) }}:</text>
              <text class="comment-content">{{ comment.content }}</text>
            </view>
            <view class="view-all" v-if="post.commentCount > 2" @click.stop="goToPostDetail(post)">
              <text>查看全部{{ post.commentCount }}条评论</text>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import postsService from '@/services/posts'
import websocketService from '@/services/websocket'
import didService from '@/services/did'

export default {
  data() {
    return {
      posts: [],
      loading: false,
      refreshing: false,
      realtimeConnected: false
    }
  },

  onLoad() {
    this.loadTimeline()
    this.setupRealtime()
  },

  onShow() {
    // 每次显示时刷新
    this.loadTimeline()
  },

  onUnload() {
    // 清理实时监听
    this.cleanupRealtime()
  },

  methods: {
    async setupRealtime() {
      try {
        const identity = await didService.getCurrentIdentity()
        if (!identity) return

        await websocketService.ensureConnection({ did: identity.did })
        this.realtimeConnected = websocketService.isReady()

        // 监听新动态
        websocketService.on('post:created', this.handleNewPost)
        // 监听点赞更新
        websocketService.on('post:liked', this.handlePostLiked)
        websocketService.on('post:unliked', this.handlePostUnliked)
        // 监听评论更新
        websocketService.on('post:commented', this.handlePostCommented)
      } catch (error) {
        console.error('设置实时连接失败:', error)
      }
    },

    cleanupRealtime() {
      websocketService.off('post:created', this.handleNewPost)
      websocketService.off('post:liked', this.handlePostLiked)
      websocketService.off('post:unliked', this.handlePostUnliked)
      websocketService.off('post:commented', this.handlePostCommented)
    },

    handleNewPost(data) {
      if (data && data.post) {
        // 在列表顶部添加新动态
        this.posts.unshift(data.post)
        uni.showToast({
          title: '收到新动态',
          icon: 'none',
          duration: 1500
        })
      }
    },

    handlePostLiked(data) {
      if (data && data.postId) {
        const post = this.posts.find(p => p.id === data.postId)
        if (post) {
          post.likeCount = (post.likeCount || 0) + 1
          if (data.fromCurrentUser) {
            post.isLiked = true
          }
        }
      }
    },

    handlePostUnliked(data) {
      if (data && data.postId) {
        const post = this.posts.find(p => p.id === data.postId)
        if (post) {
          post.likeCount = Math.max(0, (post.likeCount || 0) - 1)
          if (data.fromCurrentUser) {
            post.isLiked = false
          }
        }
      }
    },

    handlePostCommented(data) {
      if (data && data.postId) {
        const post = this.posts.find(p => p.id === data.postId)
        if (post) {
          post.commentCount = (post.commentCount || 0) + 1
          if (data.comment) {
            if (!post.comments) {
              post.comments = []
            }
            post.comments.push(data.comment)
          }
        }
      }
    },
    async loadTimeline() {
      this.loading = true
      try {
        await postsService.init()
        this.posts = await postsService.getTimeline()
      } catch (error) {
        console.error('加载动态失败:', error)
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
        await this.loadTimeline()
      } finally {
        this.refreshing = false
      }
    },

    async toggleLike(post) {
      try {
        if (post.isLiked) {
          await postsService.unlikePost(post.id)
          post.isLiked = false
          post.likeCount = Math.max(0, (post.likeCount || 0) - 1)
        } else {
          await postsService.likePost(post.id)
          post.isLiked = true
          post.likeCount = (post.likeCount || 0) + 1
        }
      } catch (error) {
        console.error('操作失败:', error)
        uni.showToast({
          title: error.message || '操作失败',
          icon: 'none'
        })
      }
    },

    goToCreate() {
      uni.navigateTo({
        url: '/pages/social/timeline/create'
      })
    },

    goToPostDetail(post) {
      uni.navigateTo({
        url: `/pages/social/timeline/detail?id=${post.id}`
      })
    },

    async sharePost(post) {
      try {
        const shareOptions = ['分享到好友', '复制链接', '生成分享图片', '取消']
        const res = await uni.showActionSheet({
          itemList: shareOptions.slice(0, -1)
        })

        switch (res.tapIndex) {
          case 0: // 分享到好友
            await this.shareToFriend(post)
            break
          case 1: // 复制链接
            await this.copyPostLink(post)
            break
          case 2: // 生成分享图片
            await this.generateShareImage(post)
            break
        }
      } catch (error) {
        if (error.errMsg !== 'showActionSheet:fail cancel') {
          console.error('分享失败:', error)
        }
      }
    },

    async shareToFriend(post) {
      // 跳转到好友选择页面
      uni.navigateTo({
        url: `/pages/social/share-select?postId=${post.id}&type=post`
      })
    },

    async copyPostLink(post) {
      try {
        const link = `chainlesschain://post/${post.id}`
        await uni.setClipboardData({
          data: link
        })
        uni.showToast({
          title: '链接已复制',
          icon: 'success'
        })
      } catch (error) {
        console.error('复制链接失败:', error)
        uni.showToast({
          title: '复制失败',
          icon: 'none'
        })
      }
    },

    async generateShareImage(post) {
      uni.showToast({
        title: '正在生成分享图片...',
        icon: 'loading',
        duration: 2000
      })
      // TODO: 实现分享图片生成
      setTimeout(() => {
        uni.showToast({
          title: '分享图片功能即将上线',
          icon: 'none'
        })
      }, 2000)
    },

    getAuthorAvatar(post) {
      if (post.friendInfo && post.friendInfo.nickname) {
        return post.friendInfo.nickname.substring(0, 2)
      }
      return post.authorDid ? post.authorDid.slice(-2).toUpperCase() : '?'
    },

    getAuthorName(post) {
      if (post.friendInfo && post.friendInfo.nickname) {
        return post.friendInfo.nickname
      }
      return this.formatDid(post.authorDid)
    },

    getCommentAuthor(comment) {
      if (comment.friendInfo && comment.friendInfo.nickname) {
        return comment.friendInfo.nickname
      }
      return this.formatDid(comment.authorDid).substring(0, 12) + '...'
    },

    getPrivacyIcon(visibility) {
      switch (visibility) {
        case 'public':
          return '🌍'
        case 'friends':
          return '👥'
        case 'private':
          return '🔒'
        default:
          return '👥'
      }
    },

    formatDid(did) {
      if (!did || did.length <= 32) {
        return did
      }
      return `${did.substring(0, 20)}...${did.slice(-6)}`
    },

    formatTime(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      // 1分钟内
      if (diff < 60000) {
        return '刚刚'
      }
      // 1小时内
      if (diff < 3600000) {
        return `${Math.floor(diff / 60000)}分钟前`
      }
      // 24小时内
      if (diff < 86400000) {
        return `${Math.floor(diff / 3600000)}小时前`
      }
      // 7天内
      if (diff < 604800000) {
        return `${Math.floor(diff / 86400000)}天前`
      }

      // 更早
      return `${date.getMonth() + 1}月${date.getDate()}日`
    }
  }
}
</script>

<style lang="scss" scoped>
.timeline-container {
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

.posts-list {
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

  .create-post-btn {
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

.posts {
  padding: 16rpx 0;
}

.post-item {
  background: var(--bg-card);
  margin-bottom: 16rpx;
  padding: 32rpx;

  .post-header {
    display: flex;
    align-items: center;
    margin-bottom: 24rpx;

    .author-avatar {
      width: 80rpx;
      height: 80rpx;
      border-radius: 40rpx;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 16rpx;

      .avatar-text {
        font-size: 32rpx;
        font-weight: bold;
        color: white;
      }
    }

    .author-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4rpx;

      .author-name {
        font-size: 28rpx;
        font-weight: bold;
        color: var(--text-primary);
      }

      .post-time {
        font-size: 22rpx;
        color: var(--text-tertiary);
      }
    }

    .post-privacy {
      .privacy-icon {
        font-size: 28rpx;
      }
    }
  }

  .post-content {
    margin-bottom: 24rpx;

    .content-text {
      font-size: 28rpx;
      color: var(--text-primary);
      line-height: 1.6;
      word-break: break-word;
      white-space: pre-wrap;
    }
  }

  .post-images {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8rpx;
    margin-bottom: 24rpx;

    .post-image {
      width: 100%;
      height: 200rpx;
      border-radius: 8rpx;
    }
  }

  .post-actions {
    display: flex;
    gap: 48rpx;
    padding: 16rpx 0;
    border-top: 1rpx solid var(--border-color);

    .action-item {
      display: flex;
      align-items: center;
      gap: 8rpx;

      &.active {
        .action-text {
          color: var(--color-error);
        }
      }

      .action-icon {
        font-size: 32rpx;
      }

      .action-text {
        font-size: 24rpx;
        color: var(--text-secondary);
      }
    }
  }

  .comments-preview {
    margin-top: 16rpx;
    padding: 16rpx;
    background: var(--bg-secondary);
    border-radius: 12rpx;

    .comment-item {
      margin-bottom: 8rpx;

      &:last-of-type {
        margin-bottom: 12rpx;
      }

      .comment-author {
        font-size: 24rpx;
        font-weight: bold;
        color: var(--text-secondary);
        margin-right: 8rpx;
      }

      .comment-content {
        font-size: 24rpx;
        color: var(--text-primary);
      }
    }

    .view-all {
      font-size: 22rpx;
      color: var(--text-tertiary);
    }
  }
}
</style>
