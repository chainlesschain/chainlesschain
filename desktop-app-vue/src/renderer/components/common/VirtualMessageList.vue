<template>
  <div
    ref="containerRef"
    class="virtual-message-list"
    @scroll="handleScroll"
  >
    <!-- 占位符：上部分 -->
    <div :style="{ height: topPlaceholderHeight + 'px' }" />

    <!-- 可见消息 -->
    <div
      v-for="message in visibleMessages"
      :key="message.id"
      :data-message-id="message.id"
      class="message-item"
      :class="{
        'message-user': message.role === 'user',
        'message-assistant': message.role === 'assistant',
      }"
    >
      <div class="message-header">
        <div class="message-role">
          <UserOutlined v-if="message.role === 'user'" />
          <RobotOutlined v-else />
          <span>{{ message.role === 'user' ? '用户' : 'AI助手' }}</span>
        </div>
        <div class="message-time">
          {{ formatTime(message.timestamp) }}
        </div>
      </div>

      <div class="message-content">
        <!-- 文本消息 -->
        <div
          v-if="message.type === 'text'"
          class="message-text"
          v-html="renderMarkdown(message.content)"
        />

        <!-- 图片消息 - 使用懒加载 -->
        <LazyImage
          v-else-if="message.type === 'image'"
          :src="message.imageUrl"
          :thumbnail="message.thumbnailUrl"
          :alt="message.alt || '图片'"
          :width="300"
          :height="200"
          fit="cover"
          :radius="8"
          class="message-image"
        />

        <!-- 代码块 -->
        <div
          v-else-if="message.type === 'code'"
          class="message-code"
        >
          <pre><code>{{ message.content }}</code></pre>
        </div>

        <!-- 其他类型 -->
        <div
          v-else
          class="message-text"
        >
          {{ message.content }}
        </div>
      </div>
    </div>

    <!-- 占位符：下部分 -->
    <div :style="{ height: bottomPlaceholderHeight + 'px' }" />

    <!-- 滚动到底部按钮 -->
    <transition name="fade">
      <a-button
        v-if="!isAtBottom"
        class="scroll-to-bottom"
        type="primary"
        shape="circle"
        @click="scrollToBottom"
      >
        <DownOutlined />
      </a-button>
    </transition>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { UserOutlined, RobotOutlined, DownOutlined } from '@ant-design/icons-vue'
import { marked } from 'marked'

const props = defineProps({
  messages: {
    type: Array,
    required: true,
    default: () => [],
  },
  itemHeight: {
    type: Number,
    default: 150, // 默认消息高度
  },
  bufferSize: {
    type: Number,
    default: 5, // 缓冲区大小（上下各渲染5条）
  },
  autoScroll: {
    type: Boolean,
    default: true, // 新消息时自动滚动到底部
  },
})

const emit = defineEmits(['load-more'])

// Refs
const containerRef = ref(null)
const scrollTop = ref(0)
const containerHeight = ref(0)
const isAtBottom = ref(true)

// 计算可见范围
const visibleRange = computed(() => {
  const start = Math.floor(scrollTop.value / props.itemHeight)
  const end = Math.ceil((scrollTop.value + containerHeight.value) / props.itemHeight)

  return {
    start: Math.max(0, start - props.bufferSize),
    end: Math.min(props.messages.length, end + props.bufferSize),
  }
})

// 可见消息
const visibleMessages = computed(() => {
  return props.messages.slice(visibleRange.value.start, visibleRange.value.end)
})

// 上部占位符高度
const topPlaceholderHeight = computed(() => {
  return visibleRange.value.start * props.itemHeight
})

// 下部占位符高度
const bottomPlaceholderHeight = computed(() => {
  const remainingItems = props.messages.length - visibleRange.value.end
  return Math.max(0, remainingItems * props.itemHeight)
})

// 处理滚动
const handleScroll = () => {
  if (!containerRef.value) {return}

  scrollTop.value = containerRef.value.scrollTop
  containerHeight.value = containerRef.value.clientHeight

  // 检查是否在底部
  const scrollHeight = containerRef.value.scrollHeight
  const threshold = 50 // 距离底部50px内认为在底部
  isAtBottom.value = scrollHeight - scrollTop.value - containerHeight.value < threshold

  // 滚动到顶部时触发加载更多
  if (scrollTop.value < 100) {
    emit('load-more')
  }
}

// 滚动到底部
const scrollToBottom = (smooth = true) => {
  if (!containerRef.value) {return}

  containerRef.value.scrollTo({
    top: containerRef.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  })
}

// 渲染Markdown
const renderMarkdown = (content) => {
  if (!content) {return ''}

  try {
    return marked(content, {
      breaks: true,
      gfm: true,
    })
  } catch (error) {
    logger.error('Markdown render error:', error)
    return content
  }
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return ''}

  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date

  // 小于1分钟
  if (diff < 60 * 1000) {
    return '刚刚'
  }

  // 小于1小时
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))}分钟前`
  }

  // 小于24小时
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))}小时前`
  }

  // 显示具体时间
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 监听消息变化，自动滚动到底部
watch(
  () => props.messages.length,
  async (newLength, oldLength) => {
    if (props.autoScroll && newLength > oldLength && isAtBottom.value) {
      await nextTick()
      scrollToBottom(true)
    }
  }
)

// 初始化
onMounted(() => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight

    // 初始滚动到底部
    nextTick(() => {
      scrollToBottom(false)
    })
  }

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize)
})

// 清理
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

// 处理窗口大小变化
const handleResize = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight
  }
}

// 暴露方法
defineExpose({
  scrollToBottom,
})
</script>

<style scoped>
.virtual-message-list {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  padding: 16px;
  background: #f5f7fa;
}

.message-item {
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
}

.message-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.message-user {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.message-user .message-header {
  color: rgba(255, 255, 255, 0.9);
}

.message-assistant {
  background: white;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 12px;
  color: #6b7280;
}

.message-role {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.message-time {
  font-size: 11px;
  opacity: 0.8;
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
}

.message-user .message-content {
  color: white;
}

.message-text :deep(p) {
  margin: 0 0 8px 0;
}

.message-text :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text :deep(code) {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.message-user .message-text :deep(code) {
  background: rgba(255, 255, 255, 0.2);
}

.message-code {
  background: #1e1e1e;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}

.message-code pre {
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #d4d4d4;
}

.message-image {
  border-radius: 8px;
  overflow: hidden;
}

.scroll-to-bottom {
  position: fixed;
  bottom: 80px;
  right: 32px;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 滚动条样式 */
.virtual-message-list::-webkit-scrollbar {
  width: 8px;
}

.virtual-message-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.virtual-message-list::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

.virtual-message-list::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
