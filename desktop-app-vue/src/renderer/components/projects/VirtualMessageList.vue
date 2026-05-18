<template>
  <div
    ref="scrollContainer"
    class="virtual-message-list"
    @scroll="handleScroll"
  >
    <!-- 🔥 虚拟滚动模式：仅当virtualizer已初始化且有虚拟项时使用 -->
    <div
      v-if="virtualizer && virtualItems.length > 0"
      :style="{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }"
    >
      <div
        v-for="virtualRow in virtualItems"
        :key="virtualRow.key"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualRow.start}px)`,
        }"
      >
        <slot
          :message="messages[virtualRow.index]"
          :index="virtualRow.index"
        />
      </div>
    </div>

    <!-- 🔥 降级渲染：virtualizer未初始化或没有虚拟项时显示所有消息 -->
    <div
      v-else
      class="fallback-list"
    >
      <div
        v-for="(message, index) in messages"
        :key="message.id || index"
      >
        <slot
          :message="message"
          :index="index"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { Virtualizer } from "@tanstack/virtual-core";

const props = defineProps({
  messages: {
    type: Array,
    required: true,
    default: () => [],
  },
  estimateSize: {
    type: Number,
    default: 120, // 默认估计每条消息高度120px
  },
});

const emit = defineEmits(["scroll-to-bottom", "load-more"]);

const scrollContainer = ref(null);
const virtualizer = ref(null);
const updateKey = ref(0); // 用于强制更新

// 创建一个响应式的虚拟项列表
const virtualItems = computed(() => {
  if (!virtualizer.value) {
    return [];
  }
  // 访问updateKey以确保当它变化时重新计算
  updateKey.value;
  return virtualizer.value.getVirtualItems();
});

// 初始化虚拟滚动器
const initVirtualizer = () => {
  if (!scrollContainer.value) {
    logger.warn("[VirtualMessageList] scrollContainer not ready");
    return;
  }

  try {
    virtualizer.value = new Virtualizer({
      count: props.messages.length,
      getScrollElement: () => scrollContainer.value,
      estimateSize: (index) => props.estimateSize,
      overscan: 5, // 预渲染5条额外消息
      scrollMargin: 0,
      // 添加onChange回调来监听virtualizer的变化
      onChange: (instance) => {
        // 强制更新以触发computed重新计算
        updateKey.value++;
      },
    });
    // 🔥 关键修复：初始化后立即测量并强制更新
    nextTick(() => {
      if (virtualizer.value && scrollContainer.value) {
        virtualizer.value.measure();
        updateKey.value++;

        // 🔥 额外修复：触发一次scroll事件来强制virtualizer计算项目
        // 临时滚动1px然后滚回0，触发计算
        scrollContainer.value.scrollTop = 1;
        setTimeout(() => {
          if (scrollContainer.value) {
            scrollContainer.value.scrollTop = 0;
          }
        }, 50);
      }
    });
  } catch (error) {
    logger.error(
      "[VirtualMessageList] Failed to initialize virtualizer:",
      error,
    );
  }
};

// 处理滚动事件
const handleScroll = () => {
  if (!scrollContainer.value) {
    return;
  }

  // 🔥 关键修复：通知virtualizer滚动位置已改变
  if (virtualizer.value) {
    virtualizer.value.measure();
  }

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;

  // 检测是否滚动到顶部（加载更多历史消息）
  if (scrollTop < 100) {
    emit("load-more");
  }

  // 检测是否滚动到底部
  if (scrollTop + clientHeight >= scrollHeight - 50) {
    emit("scroll-to-bottom");
  }
};

// 滚动到底部
const scrollToBottom = () => {
  if (!scrollContainer.value) {
    return;
  }

  requestAnimationFrame(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    }
  });
};

// 滚动到特定消息
const scrollToMessage = (messageId) => {
  const index = props.messages.findIndex((m) => m.id === messageId);
  if (index !== -1 && virtualizer.value) {
    virtualizer.value.scrollToIndex(index, { align: "center" });
  }
};

// 监听消息变化
watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    if (virtualizer.value) {
      virtualizer.value.setOptions({
        count: newLength,
        estimateSize: (index) => props.estimateSize,
      });

      // 🔥 强制更新虚拟列表以响应长度变化
      updateKey.value++;

      // 如果是新增消息，自动滚动到底部
      if (newLength > oldLength) {
        nextTick(() => {
          scrollToBottom();
        });
      }
    } else {
      // 如果virtualizer未初始化，尝试初始化
      nextTick(() => {
        initVirtualizer();
        // 初始化后也要强制更新
        if (virtualizer.value) {
          updateKey.value++;
        }
      });
    }
  },
);

// 监听messages数组本身的变化（深度监听以捕获内容更新）
watch(
  () => props.messages,
  (newMessages, oldMessages) => {
    if (!virtualizer.value && newMessages.length > 0) {
      nextTick(() => {
        initVirtualizer();
      });
    } else if (virtualizer.value) {
      // 🔥 关键修复：先重置 virtualizer 的选项以强制刷新
      virtualizer.value.setOptions({
        count: newMessages.length,
        estimateSize: (index) => props.estimateSize,
        getScrollElement: () => scrollContainer.value,
        overscan: 5,
        scrollMargin: 0,
        onChange: (instance) => {
          updateKey.value++;
        },
      });

      updateKey.value++;

      // 🔥 额外修复：强制测量以重新计算项目高度
      nextTick(() => {
        if (virtualizer.value) {
          virtualizer.value.measure();
        }
      });
    }
  },
  { deep: true },
);

// 暴露方法给父组件
defineExpose({
  scrollToBottom,
  scrollToMessage,
});

onMounted(() => {
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
