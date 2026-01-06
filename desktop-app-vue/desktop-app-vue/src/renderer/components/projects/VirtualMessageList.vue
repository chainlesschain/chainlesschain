<template>
  <div ref="scrollContainer" class="virtual-message-list" @scroll="handleScroll">
    <!-- 🔥 添加安全检查，防止virtualizer为null时报错 -->
    <div
      v-if="virtualizer"
      :style="{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative'
      }"
    >
      <div
        v-for="virtualRow in virtualizer.getVirtualItems()"
        :key="virtualRow.key"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualRow.start}px)`
        }"
      >
        <slot :message="messages[virtualRow.index]" :index="virtualRow.index" />
      </div>
    </div>

    <!-- 🔥 降级渲染：virtualizer未初始化时显示所有消息 -->
    <div v-else class="fallback-list">
      <div v-for="(message, index) in messages" :key="message.id || index">
        <slot :message="message" :index="index" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Virtualizer } from '@tanstack/virtual-core';

const props = defineProps({
  messages: {
    type: Array,
    required: true,
    default: () => []
  },
  estimateSize: {
    type: Number,
    default: 120 // 默认估计每条消息高度120px
  }
});

const emit = defineEmits(['scroll-to-bottom', 'load-more']);

const scrollContainer = ref(null);
const virtualizer = ref(null);

// 初始化虚拟滚动器
const initVirtualizer = () => {
  if (!scrollContainer.value) {
    console.warn('[VirtualMessageList] scrollContainer not ready');
    return;
  }

  try {
    virtualizer.value = new Virtualizer({
      count: props.messages.length,
      getScrollElement: () => scrollContainer.value,
      estimateSize: () => props.estimateSize,
      overscan: 5, // 预渲染5条额外消息
      scrollMargin: 0
    });
    console.log('[VirtualMessageList] Virtualizer initialized with', props.messages.length, 'messages');
  } catch (error) {
    console.error('[VirtualMessageList] Failed to initialize virtualizer:', error);
  }
};

// 处理滚动事件
const handleScroll = () => {
  if (!scrollContainer.value) return;

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;

  // 检测是否滚动到顶部（加载更多历史消息）
  if (scrollTop < 100) {
    emit('load-more');
  }

  // 检测是否滚动到底部
  if (scrollTop + clientHeight >= scrollHeight - 50) {
    emit('scroll-to-bottom');
  }
};

// 滚动到底部
const scrollToBottom = () => {
  if (!scrollContainer.value) return;

  requestAnimationFrame(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    }
  });
};

// 滚动到特定消息
const scrollToMessage = (messageId) => {
  const index = props.messages.findIndex(m => m.id === messageId);
  if (index !== -1 && virtualizer.value) {
    virtualizer.value.scrollToIndex(index, { align: 'center' });
  }
};

// 监听消息变化
watch(() => props.messages.length, (newLength, oldLength) => {
  if (virtualizer.value) {
    virtualizer.value.setOptions({
      count: newLength
    });

    // 如果是新增消息，自动滚动到底部
    if (newLength > oldLength) {
      nextTick(() => {
        scrollToBottom();
      });
    }
  } else {
    // 如果virtualizer未初始化，尝试初始化
    console.log('[VirtualMessageList] Virtualizer not initialized, attempting to initialize...');
    nextTick(() => {
      initVirtualizer();
    });
  }
});

// 监听messages数组本身的变化（不仅仅是长度）
watch(() => props.messages, (newMessages) => {
  if (!virtualizer.value && newMessages.length > 0) {
    console.log('[VirtualMessageList] Messages updated, initializing virtualizer...');
    nextTick(() => {
      initVirtualizer();
    });
  }
}, { deep: false });

// 暴露方法给父组件
defineExpose({
  scrollToBottom,
  scrollToMessage
});

onMounted(() => {
  console.log('[VirtualMessageList] Component mounted with', props.messages.length, 'messages');
  nextTick(() => {
    initVirtualizer();
    if (props.messages.length > 0) {
      scrollToBottom();
    }
  });
});

onUnmounted(() => {
  if (virtualizer.value) {
    virtualizer.value = null;
  }
});
</script>

<style scoped>
.virtual-message-list {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.fallback-list {
  width: 100%;
}

.virtual-message-list::-webkit-scrollbar {
  width: 6px;
}

.virtual-message-list::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.virtual-message-list::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.virtual-message-list::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
