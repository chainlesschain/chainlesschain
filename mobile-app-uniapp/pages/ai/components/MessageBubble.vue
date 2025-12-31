<template>
  <view
    class="message-wrapper"
    :class="{ 'is-mine': isMine }"
    @longpress="handleLongPress"
  >
    <view class="message-bubble">
      <!-- 消息头部 -->
      <view class="message-header">
        <text class="message-role">{{ isMine ? '你' : 'AI' }}</text>
        <text class="message-time">{{ formatTime(message.createdAt) }}</text>
      </view>

      <!-- 用户消息：纯文本 -->
      <view v-if="isMine" class="message-content">
        <text class="message-text">{{ message.content }}</text>
      </view>

      <!-- AI消息：Markdown渲染 -->
      <MarkdownRenderer
        v-else
        :content="message.content"
        class="message-content"
      />

      <!-- 消息底部信息（可选） -->
      <view v-if="message.tokens && !isMine" class="message-footer">
        <text class="message-tokens">{{ message.tokens }} tokens</text>
      </view>
    </view>
  </view>
</template>

<script>
import MarkdownRenderer from './MarkdownRenderer.vue'

export default {
  name: 'MessageBubble',
  components: {
    MarkdownRenderer
  },
  props: {
    message: {
      type: Object,
      required: true
    },
    isMine: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    /**
     * 格式化时间显示
     */
    formatTime(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      })
    },

    /**
     * 长按消息处理
     */
    handleLongPress() {
      this.$emit('longpress', this.message)
    }
  }
}
</script>

<style scoped>
.message-wrapper {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 16px;
}

.message-wrapper.is-mine {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 75%;
  background: white;
  border-radius: 16px;
  padding: 12px 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.message-wrapper.is-mine .message-bubble {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.message-role {
  font-size: 12px;
  font-weight: 600;
  color: #666;
}

.message-wrapper.is-mine .message-role {
  color: rgba(255, 255, 255, 0.9);
}

.message-time {
  font-size: 11px;
  color: #999;
}

.message-wrapper.is-mine .message-time {
  color: rgba(255, 255, 255, 0.7);
}

.message-content {
  font-size: 15px;
  line-height: 1.6;
  color: #333;
  word-wrap: break-word;
  word-break: break-word;
}

.message-text {
  white-space: pre-wrap;
}

.message-wrapper.is-mine .message-content {
  color: white;
}

.message-footer {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.message-wrapper.is-mine .message-footer {
  border-top-color: rgba(255, 255, 255, 0.2);
}

.message-tokens {
  font-size: 11px;
  color: #999;
}

.message-wrapper.is-mine .message-tokens {
  color: rgba(255, 255, 255, 0.7);
}

/* Markdown内容在用户消息气泡中的样式（如果有的话） */
.message-wrapper.is-mine ::v-deep .markdown-content {
  color: white;
}

.message-wrapper.is-mine ::v-deep .markdown-content h1,
.message-wrapper.is-mine ::v-deep .markdown-content h2,
.message-wrapper.is-mine ::v-deep .markdown-content h3,
.message-wrapper.is-mine ::v-deep .markdown-content p,
.message-wrapper.is-mine ::v-deep .markdown-content li {
  color: white;
}

.message-wrapper.is-mine ::v-deep .markdown-content a {
  color: rgba(255, 255, 255, 0.9);
  text-decoration: underline;
}

.message-wrapper.is-mine ::v-deep .markdown-content code {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}
</style>
