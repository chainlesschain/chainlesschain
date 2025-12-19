<template>
  <view class="posts-page">
    <scroll-view class="content" scroll-y>
      <view class="post-item" v-for="post in posts" :key="post.id">
        <view class="header">
          <text class="avatar">👤</text>
          <view class="info">
            <text class="name">{{ post.author }}</text>
            <text class="time">{{ post.time }}</text>
          </view>
        </view>
        <text class="content-text">{{ post.content }}</text>
        <view class="actions">
          <text class="action">❤️ {{ post.likes }}</text>
          <text class="action">💬 {{ post.comments }}</text>
        </view>
      </view>
    </scroll-view>
    <view class="fab" @click="showPublish">✏️</view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      posts: [
        { id: 1, author: 'Alice', content: '今天天气不错！', likes: 5, comments: 2, time: '2小时前' },
        { id: 2, author: 'Bob', content: '学习 Web3 真有趣', likes: 8, comments: 3, time: '5小时前' }
      ]
    }
  },
  methods: {
    showPublish() {
      uni.showToast({ title: '发布功能开发中', icon: 'none' })
    }
  }
}
</script>

<style lang="scss" scoped>
.posts-page {
  min-height: 100vh;
  background-color: #f8f8f8;
}
.content {
  height: calc(100vh - 100rpx);
  padding: 24rpx;
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
    .avatar {
      font-size: 48rpx;
    }
    .info {
      display: flex;
      flex-direction: column;
      gap: 8rpx;
      .name {
        font-size: 28rpx;
        font-weight: 500;
      }
      .time {
        font-size: 24rpx;
        color: #999;
      }
    }
  }
  .content-text {
    font-size: 28rpx;
    line-height: 1.6;
    color: #333;
    margin-bottom: 20rpx;
  }
  .actions {
    display: flex;
    gap: 40rpx;
    .action {
      font-size: 24rpx;
      color: #666;
    }
  }
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
  box-shadow: 0 8rpx 24rpx rgba(60, 197, 31, 0.4);
}
</style>
