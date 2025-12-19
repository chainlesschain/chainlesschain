<template>
  <view class="posts-page">
    <scroll-view
      class="content"
      scroll-y
      @scrolltolower="loadMore"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- 加载状态 -->
      <view class="loading" v-if="loading && posts.length === 0">
        <text>加载中...</text>
      </view>

      <!-- 空状态 -->
      <view class="empty" v-else-if="posts.length === 0">
        <text class="empty-icon">📝</text>
        <text class="empty-text">还没有动态</text>
        <text class="empty-hint">点击右下角 ✏️ 发布第一条动态</text>
      </view>

      <!-- 动态列表 -->
      <view class="post-item" v-for="post in posts" :key="post.id">
        <view class="header">
          <text class="avatar">👤</text>
          <view class="info">
            <text class="name">{{ getAuthorName(post.author_did) }}</text>
            <text class="time">{{ formatTime(post.created_at) }}</text>
          </view>
          <view class="more" @click="showPostMenu(post)" v-if="post.author_did === myDid">
            <text>⋯</text>
          </view>
        </view>

        <text class="content-text">{{ post.content }}</text>

        <view class="actions">
          <view
            class="action"
            :class="{ liked: post.isLiked }"
            @click="toggleLike(post)"
          >
            <text>{{ post.isLiked ? '❤️' : '🤍' }} {{ post.like_count || 0 }}</text>
          </view>
          <view class="action" @click="showComments(post)">
            <text>💬 {{ post.comment_count || 0 }}</text>
          </view>
        </view>
      </view>

      <!-- 加载更多 -->
      <view class="load-more" v-if="hasMore && !loading">
        <text>加载更多...</text>
      </view>
    </scroll-view>

    <!-- 发布按钮 -->
    <view class="fab" @click="showPublishModal">
      <text>✏️</text>
    </view>

    <!-- 发布动态弹窗 -->
    <view class="modal" v-if="showPublish" @click="closePublishModal">
      <view class="modal-content publish-modal" @click.stop>
        <text class="modal-title">发布动态</text>

        <textarea
          class="publish-input"
          v-model="newPost.content"
          placeholder="分享新鲜事..."
          :maxlength="500"
          :auto-height="true"
        />

        <view class="char-count">
          <text>{{ newPost.content.length }}/500</text>
        </view>

        <view class="visibility-select">
          <text class="label">可见性：</text>
          <view class="visibility-options">
            <view
              class="option"
              :class="{ active: newPost.visibility === 'public' }"
              @click="newPost.visibility = 'public'"
            >
              <text>🌍 公开</text>
            </view>
            <view
              class="option"
              :class="{ active: newPost.visibility === 'friends' }"
              @click="newPost.visibility = 'friends'"
            >
              <text>👥 好友可见</text>
            </view>
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closePublishModal">取消</button>
          <button
            class="modal-btn confirm"
            @click="handlePublish"
            :disabled="!newPost.content.trim() || publishing"
          >
            {{ publishing ? '发布中...' : '发布' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 评论弹窗 -->
    <view class="modal" v-if="showCommentModal" @click="closeCommentModal">
      <view class="modal-content comment-modal" @click.stop>
        <view class="comment-header">
          <text class="modal-title">评论 ({{ currentPost.comment_count || 0 }})</text>
          <view class="close-btn" @click="closeCommentModal">
            <text>✕</text>
          </view>
        </view>

        <scroll-view class="comments-list" scroll-y>
          <view class="comment-item" v-for="comment in comments" :key="comment.id">
            <text class="comment-avatar">👤</text>
            <view class="comment-content">
              <view class="comment-info">
                <text class="comment-author">{{ getAuthorName(comment.author_did) }}</text>
                <text class="comment-time">{{ formatTime(comment.created_at) }}</text>
              </view>
              <text class="comment-text">{{ comment.content }}</text>
            </view>
            <view
              class="comment-delete"
              v-if="comment.author_did === myDid"
              @click="deleteComment(comment)"
            >
              <text>🗑️</text>
            </view>
          </view>

          <view class="no-comments" v-if="comments.length === 0">
            <text>还没有评论，快来抢沙发吧~</text>
          </view>
        </scroll-view>

        <view class="comment-input-box">
          <input
            class="comment-input"
            v-model="newComment"
            placeholder="说点什么..."
            :maxlength="200"
            @confirm="handleAddComment"
          />
          <button
            class="comment-btn"
            @click="handleAddComment"
            :disabled="!newComment.trim() || commenting"
          >
            {{ commenting ? '...' : '发送' }}
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
      posts: [],
      loading: false,
      refreshing: false,
      hasMore: true,
      showPublish: false,
      publishing: false,
      newPost: {
        content: '',
        visibility: 'public'
      },
      showCommentModal: false,
      currentPost: {},
      comments: [],
      newComment: '',
      commenting: false,
      myDid: '',
      friendsMap: {} // 好友昵称映射
    }
  },
  onLoad() {
    this.initUserDid()
    this.loadFriends()
    this.loadPosts()
  },
  onShow() {
    // 每次显示时刷新
    this.loadPosts()
  },
  onPullDownRefresh() {
    this.onRefresh().then(() => {
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
     * 加载好友列表（用于显示昵称）
     */
    async loadFriends() {
      try {
        const friends = await db.getFriends('accepted')
        this.friendsMap = {}
        friends.forEach(f => {
          this.friendsMap[f.friend_did] = f.nickname || f.friend_did
        })
        // 添加自己
        this.friendsMap[this.myDid] = '我'
      } catch (error) {
        console.error('加载好友列表失败:', error)
      }
    },

    /**
     * 获取作者昵称
     */
    getAuthorName(authorDid) {
      return this.friendsMap[authorDid] || authorDid.substring(0, 12) + '...'
    },

    /**
     * 加载动态列表
     */
    async loadPosts() {
      this.loading = true
      try {
        const posts = await db.getPosts('all', 50)

        // 为每个动态添加isLiked标记（简化处理，实际应该查询点赞表）
        this.posts = posts.map(post => ({
          ...post,
          isLiked: false
        }))

        console.log('加载动态列表:', this.posts.length)
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

    /**
     * 下拉刷新
     */
    async onRefresh() {
      this.refreshing = true
      await this.loadPosts()
      this.refreshing = false
    },

    /**
     * 加载更多
     */
    loadMore() {
      // 预留分页功能
      console.log('加载更多')
    },

    /**
     * 显示发布弹窗
     */
    showPublishModal() {
      this.showPublish = true
      this.newPost = {
        content: '',
        visibility: 'public'
      }
    },

    /**
     * 关闭发布弹窗
     */
    closePublishModal() {
      this.showPublish = false
    },

    /**
     * 发布动态
     */
    async handlePublish() {
      if (!this.newPost.content.trim()) {
        return
      }

      try {
        this.publishing = true

        await db.createPost(
          this.myDid,
          this.newPost.content.trim(),
          this.newPost.visibility
        )

        uni.showToast({
          title: '发布成功',
          icon: 'success'
        })

        this.closePublishModal()

        // 刷新列表
        await this.loadPosts()
      } catch (error) {
        console.error('发布失败:', error)
        uni.showToast({
          title: '发布失败',
          icon: 'none'
        })
      } finally {
        this.publishing = false
      }
    },

    /**
     * 切换点赞
     */
    async toggleLike(post) {
      try {
        if (post.isLiked) {
          // 取消点赞
          await db.unlikePost(post.id)
          post.like_count = Math.max(0, (post.like_count || 0) - 1)
          post.isLiked = false
        } else {
          // 点赞
          await db.likePost(post.id)
          post.like_count = (post.like_count || 0) + 1
          post.isLiked = true
        }
      } catch (error) {
        console.error('点赞操作失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    /**
     * 显示评论
     */
    async showComments(post) {
      this.currentPost = post
      this.showCommentModal = true
      this.newComment = ''
      await this.loadComments(post.id)
    },

    /**
     * 关闭评论弹窗
     */
    closeCommentModal() {
      this.showCommentModal = false
      this.currentPost = {}
      this.comments = []
    },

    /**
     * 加载评论列表
     */
    async loadComments(postId) {
      try {
        const comments = await db.getComments(postId)
        this.comments = comments
        console.log('加载评论:', this.comments.length)
      } catch (error) {
        console.error('加载评论失败:', error)
      }
    },

    /**
     * 添加评论
     */
    async handleAddComment() {
      if (!this.newComment.trim()) {
        return
      }

      try {
        this.commenting = true

        await db.addComment(
          this.currentPost.id,
          this.myDid,
          this.newComment.trim()
        )

        // 更新当前动态的评论数
        const post = this.posts.find(p => p.id === this.currentPost.id)
        if (post) {
          post.comment_count = (post.comment_count || 0) + 1
          this.currentPost.comment_count = post.comment_count
        }

        this.newComment = ''

        // 刷新评论列表
        await this.loadComments(this.currentPost.id)

        uni.showToast({
          title: '评论成功',
          icon: 'success',
          duration: 1500
        })
      } catch (error) {
        console.error('评论失败:', error)
        uni.showToast({
          title: '评论失败',
          icon: 'none'
        })
      } finally {
        this.commenting = false
      }
    },

    /**
     * 删除评论
     */
    async deleteComment(comment) {
      try {
        await db.deleteComment(comment.id, this.currentPost.id)

        // 更新当前动态的评论数
        const post = this.posts.find(p => p.id === this.currentPost.id)
        if (post && post.comment_count > 0) {
          post.comment_count = post.comment_count - 1
          this.currentPost.comment_count = post.comment_count
        }

        // 刷新评论列表
        await this.loadComments(this.currentPost.id)

        uni.showToast({
          title: '删除成功',
          icon: 'success',
          duration: 1500
        })
      } catch (error) {
        console.error('删除评论失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    /**
     * 显示动态菜单
     */
    showPostMenu(post) {
      uni.showActionSheet({
        itemList: ['删除动态'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.deletePost(post)
          }
        }
      })
    },

    /**
     * 删除动态
     */
    deletePost(post) {
      uni.showModal({
        title: '删除动态',
        content: '确定要删除这条动态吗？',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            try {
              await db.deletePost(post.id)

              uni.showToast({
                title: '删除成功',
                icon: 'success'
              })

              // 刷新列表
              await this.loadPosts()
            } catch (error) {
              console.error('删除动态失败:', error)
              uni.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
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
.posts-page {
  min-height: 100vh;
  background-color: #f8f8f8;
  position: relative;
}

.content {
  height: calc(100vh - 100rpx);
  padding: 24rpx;
}

.loading, .empty {
  padding: 200rpx 40rpx;
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
    font-size: 32rpx;
    color: #333;
    margin-bottom: 16rpx;
  }

  .empty-hint {
    display: block;
    font-size: 24rpx;
    color: #999;
  }
}

.post-item {
  background-color: #fff;
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;

  .header {
    display: flex;
    gap: 20rpx;
    margin-bottom: 20rpx;
    align-items: center;

    .avatar {
      width: 72rpx;
      height: 72rpx;
      background-color: #e0e0e0;
      border-radius: 36rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40rpx;
      flex-shrink: 0;
    }

    .info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8rpx;

      .name {
        font-size: 28rpx;
        font-weight: 500;
        color: #333;
      }

      .time {
        font-size: 24rpx;
        color: #999;
      }
    }

    .more {
      width: 48rpx;
      height: 48rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32rpx;
      color: #999;
    }
  }

  .content-text {
    font-size: 28rpx;
    line-height: 1.6;
    color: #333;
    margin-bottom: 20rpx;
    word-wrap: break-word;
  }

  .actions {
    display: flex;
    gap: 40rpx;

    .action {
      font-size: 24rpx;
      color: #666;
      padding: 8rpx 16rpx;
      background-color: #f5f5f5;
      border-radius: 16rpx;

      &.liked {
        color: #ff4d4f;
        background-color: #fff1f0;
      }
    }
  }
}

.load-more {
  padding: 40rpx;
  text-align: center;
  color: #999;
  font-size: 24rpx;
}

.fab {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx;
  width: 112rpx;
  height: 112rpx;
  background-color: #3cc51f;
  border-radius: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  color: #ffffff;
  box-shadow: 0 8rpx 24rpx rgba(60, 197, 31, 0.4);
  z-index: 10;
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
    width: 640rpx;
    max-height: 80vh;
    background-color: #ffffff;
    border-radius: 16rpx;
    overflow: hidden;

    .modal-title {
      display: block;
      padding: 32rpx;
      font-size: 32rpx;
      font-weight: 500;
      color: #333;
      text-align: center;
      border-bottom: 1rpx solid #f0f0f0;
    }
  }

  // 发布动态弹窗
  .publish-modal {
    .publish-input {
      width: 100%;
      min-height: 300rpx;
      max-height: 500rpx;
      padding: 32rpx;
      font-size: 28rpx;
      line-height: 1.6;
    }

    .char-count {
      padding: 0 32rpx 16rpx;
      text-align: right;

      text {
        font-size: 24rpx;
        color: #999;
      }
    }

    .visibility-select {
      padding: 16rpx 32rpx 32rpx;

      .label {
        font-size: 24rpx;
        color: #666;
        margin-bottom: 16rpx;
      }

      .visibility-options {
        display: flex;
        gap: 16rpx;

        .option {
          flex: 1;
          padding: 16rpx;
          background-color: #f5f5f5;
          border-radius: 8rpx;
          text-align: center;
          font-size: 26rpx;
          color: #666;

          &.active {
            background-color: #e6f7e6;
            color: #3cc51f;
          }
        }
      }
    }

    .modal-actions {
      display: flex;
      border-top: 1rpx solid #f0f0f0;

      .modal-btn {
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

        &.cancel {
          background-color: #ffffff;
          color: #666;
          border-right: 1rpx solid #f0f0f0;
        }

        &.confirm {
          background-color: #ffffff;
          color: #3cc51f;
          font-weight: 500;

          &[disabled] {
            color: #ccc;
          }
        }
      }
    }
  }

  // 评论弹窗
  .comment-modal {
    max-height: 80vh;
    display: flex;
    flex-direction: column;

    .comment-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 24rpx 32rpx;
      border-bottom: 1rpx solid #f0f0f0;

      .modal-title {
        padding: 0;
        border: none;
        text-align: left;
      }

      .close-btn {
        width: 48rpx;
        height: 48rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32rpx;
        color: #999;
      }
    }

    .comments-list {
      flex: 1;
      max-height: 500rpx;
      padding: 24rpx;

      .comment-item {
        display: flex;
        gap: 16rpx;
        margin-bottom: 24rpx;

        .comment-avatar {
          width: 56rpx;
          height: 56rpx;
          background-color: #e0e0e0;
          border-radius: 28rpx;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32rpx;
          flex-shrink: 0;
        }

        .comment-content {
          flex: 1;

          .comment-info {
            display: flex;
            align-items: center;
            gap: 16rpx;
            margin-bottom: 8rpx;

            .comment-author {
              font-size: 24rpx;
              font-weight: 500;
              color: #333;
            }

            .comment-time {
              font-size: 20rpx;
              color: #999;
            }
          }

          .comment-text {
            font-size: 26rpx;
            line-height: 1.5;
            color: #666;
          }
        }

        .comment-delete {
          width: 48rpx;
          height: 48rpx;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28rpx;
          flex-shrink: 0;
        }
      }

      .no-comments {
        padding: 100rpx 40rpx;
        text-align: center;
        color: #999;
        font-size: 24rpx;
      }
    }

    .comment-input-box {
      display: flex;
      gap: 16rpx;
      padding: 20rpx;
      border-top: 1rpx solid #f0f0f0;
      background-color: #ffffff;

      .comment-input {
        flex: 1;
        height: 64rpx;
        padding: 0 20rpx;
        background-color: #f5f5f5;
        border-radius: 32rpx;
        font-size: 26rpx;
      }

      .comment-btn {
        width: 120rpx;
        height: 64rpx;
        background-color: #3cc51f;
        color: #ffffff;
        border-radius: 32rpx;
        font-size: 26rpx;
        border: none;
        line-height: 64rpx;
        padding: 0;

        &::after {
          border: none;
        }

        &[disabled] {
          opacity: 0.5;
        }
      }
    }
  }
}
</style>
