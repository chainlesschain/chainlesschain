<template>
  <view class="skeleton" :class="{ animate: animate }">
    <!-- 预设模板 -->
    <template v-if="type === 'list'">
      <view class="skeleton-list" v-for="i in rows" :key="i">
        <view class="skeleton-avatar" v-if="avatar"></view>
        <view class="skeleton-content">
          <view class="skeleton-title"></view>
          <view class="skeleton-paragraph">
            <view class="skeleton-row" v-for="j in 2" :key="j" :style="{ width: j === 2 ? '60%' : '100%' }"></view>
          </view>
        </view>
      </view>
    </template>

    <template v-else-if="type === 'card'">
      <view class="skeleton-card" v-for="i in rows" :key="i">
        <view class="skeleton-card-cover" v-if="cover"></view>
        <view class="skeleton-card-body">
          <view class="skeleton-title"></view>
          <view class="skeleton-paragraph">
            <view class="skeleton-row" v-for="j in 3" :key="j" :style="{ width: getRowWidth(j, 3) }"></view>
          </view>
        </view>
      </view>
    </template>

    <template v-else-if="type === 'article'">
      <view class="skeleton-article">
        <view class="skeleton-article-title"></view>
        <view class="skeleton-article-meta">
          <view class="skeleton-avatar small"></view>
          <view class="skeleton-row" style="width: 120rpx; height: 24rpx;"></view>
          <view class="skeleton-row" style="width: 80rpx; height: 24rpx;"></view>
        </view>
        <view class="skeleton-article-cover" v-if="cover"></view>
        <view class="skeleton-paragraph">
          <view class="skeleton-row" v-for="j in 6" :key="j" :style="{ width: getRowWidth(j, 6) }"></view>
        </view>
      </view>
    </template>

    <template v-else-if="type === 'chat'">
      <view class="skeleton-chat" v-for="i in rows" :key="i">
        <view class="skeleton-chat-item" :class="{ reverse: i % 2 === 0 }">
          <view class="skeleton-avatar"></view>
          <view class="skeleton-chat-bubble" :style="{ width: getChatBubbleWidth(i) }"></view>
        </view>
      </view>
    </template>

    <!-- 自定义内容 -->
    <template v-else>
      <slot></slot>
    </template>
  </view>
</template>

<script>
/**
 * Skeleton 骨架屏组件
 * 用于页面加载时显示占位效果
 *
 * @props {String} type - 骨架屏类型：list/card/article/chat/custom
 * @props {Number} rows - 行数
 * @props {Boolean} avatar - 是否显示头像占位
 * @props {Boolean} cover - 是否显示封面占位
 * @props {Boolean} animate - 是否显示动画
 */
export default {
  name: 'Skeleton',
  props: {
    type: {
      type: String,
      default: 'list',
      validator: (value) => ['list', 'card', 'article', 'chat', 'custom'].includes(value)
    },
    rows: {
      type: Number,
      default: 3
    },
    avatar: {
      type: Boolean,
      default: true
    },
    cover: {
      type: Boolean,
      default: false
    },
    animate: {
      type: Boolean,
      default: true
    }
  },
  methods: {
    /**
     * 获取行宽度（模拟自然文本长度）
     */
    getRowWidth(index, total) {
      if (index === total) {
        return '40%'
      }
      const widths = ['100%', '95%', '85%', '90%', '80%', '75%']
      return widths[(index - 1) % widths.length]
    },

    /**
     * 获取聊天气泡宽度
     */
    getChatBubbleWidth(index) {
      const widths = ['60%', '45%', '70%', '55%', '50%']
      return widths[(index - 1) % widths.length]
    }
  }
}
</script>

<style lang="scss" scoped>
.skeleton {
  padding: 24rpx;

  &.animate {
    .skeleton-avatar,
    .skeleton-title,
    .skeleton-row,
    .skeleton-card-cover,
    .skeleton-article-cover,
    .skeleton-chat-bubble {
      background: linear-gradient(
        90deg,
        var(--bg-input) 25%,
        var(--bg-hover) 50%,
        var(--bg-input) 75%
      );
      background-size: 200% 100%;
      animation: skeleton-loading 1.5s infinite;
    }
  }
}

// 头像占位
.skeleton-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background-color: var(--bg-input);
  flex-shrink: 0;

  &.small {
    width: 48rpx;
    height: 48rpx;
  }
}

// 标题占位
.skeleton-title {
  height: 32rpx;
  background-color: var(--bg-input);
  border-radius: 4rpx;
  margin-bottom: 16rpx;
  width: 50%;
}

// 段落占位
.skeleton-paragraph {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

// 行占位
.skeleton-row {
  height: 28rpx;
  background-color: var(--bg-input);
  border-radius: 4rpx;
}

// 列表类型
.skeleton-list {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid var(--border-light);

  &:last-child {
    border-bottom: none;
  }

  .skeleton-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
}

// 卡片类型
.skeleton-card {
  background-color: var(--bg-card);
  border-radius: 16rpx;
  overflow: hidden;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);

  .skeleton-card-cover {
    width: 100%;
    height: 300rpx;
    background-color: var(--bg-input);
  }

  .skeleton-card-body {
    padding: 24rpx;
  }
}

// 文章类型
.skeleton-article {
  .skeleton-article-title {
    height: 48rpx;
    background-color: var(--bg-input);
    border-radius: 4rpx;
    margin-bottom: 24rpx;
    width: 80%;
  }

  .skeleton-article-meta {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 24rpx;
  }

  .skeleton-article-cover {
    width: 100%;
    height: 360rpx;
    background-color: var(--bg-input);
    border-radius: 12rpx;
    margin-bottom: 24rpx;
  }
}

// 聊天类型
.skeleton-chat {
  padding: 16rpx 0;

  .skeleton-chat-item {
    display: flex;
    align-items: flex-start;
    gap: 16rpx;

    &.reverse {
      flex-direction: row-reverse;

      .skeleton-chat-bubble {
        border-radius: 24rpx 24rpx 8rpx 24rpx;
      }
    }
  }

  .skeleton-chat-bubble {
    height: 72rpx;
    background-color: var(--bg-input);
    border-radius: 24rpx 24rpx 24rpx 8rpx;
  }
}

@keyframes skeleton-loading {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
</style>
