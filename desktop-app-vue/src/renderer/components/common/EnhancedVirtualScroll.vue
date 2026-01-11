<template>
  <div
    ref="containerRef"
    class="enhanced-virtual-scroll"
    :style="containerStyle"
    @scroll="handleScroll"
  >
    <!-- 占位空间 -->
    <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
      <!-- 可见项容器 -->
      <div
        :style="{
          transform: `translateY(${offsetY}px)`,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
        }"
      >
        <div
          v-for="item in visibleItems"
          :key="getItemKey(item)"
          :style="getItemStyle(item)"
          class="virtual-scroll-item"
        >
          <slot :item="item.data" :index="item.index">
            {{ item.data }}
          </slot>
        </div>
      </div>
    </div>

    <!-- 加载更多 -->
    <div v-if="loading" class="virtual-scroll-loading">
      <a-spin size="small" />
      <span class="loading-text">{{ loadingText }}</span>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && items.length === 0" class="virtual-scroll-empty">
      <slot name="empty">
        <a-empty :description="emptyText" />
      </slot>
    </div>

    <!-- 滚动到顶部按钮 -->
    <transition name="fade">
      <div
        v-if="showScrollTop && scrollTop > scrollTopThreshold"
        class="scroll-to-top"
        @click="scrollToTop"
      >
        <UpOutlined />
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { UpOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  // 数据列表
  items: {
    type: Array,
    required: true,
  },
  // 项高度（固定高度模式）
  itemHeight: {
    type: Number,
    default: null,
  },
  // 估算项高度（动态高度模式）
  estimatedItemHeight: {
    type: Number,
    default: 50,
  },
  // 缓冲区大小（渲染可见区域外的项数）
  buffer: {
    type: Number,
    default: 5,
  },
  // 容器高度
  height: {
    type: [String, Number],
    default: '100%',
  },
  // 项唯一键字段
  itemKey: {
    type: [String, Function],
    default: 'id',
  },
  // 是否加载中
  loading: {
    type: Boolean,
    default: false,
  },
  // 加载文本
  loadingText: {
    type: String,
    default: '加载中...',
  },
  // 空状态文本
  emptyText: {
    type: String,
    default: '暂无数据',
  },
  // 是否显示滚动到顶部按钮
  showScrollTop: {
    type: Boolean,
    default: true,
  },
  // 滚动到顶部按钮显示阈值
  scrollTopThreshold: {
    type: Number,
    default: 300,
  },
  // 是否启用无限滚动
  infiniteScroll: {
    type: Boolean,
    default: false,
  },
  // 无限滚动距离阈值
  infiniteScrollDistance: {
    type: Number,
    default: 100,
  },
  // 是否启用虚拟化（可关闭用于调试）
  enabled: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['scroll', 'reach-bottom', 'reach-top', 'visible-change']);

const containerRef = ref(null);
const scrollTop = ref(0);
const containerHeight = ref(0);
const itemHeights = ref(new Map());
const itemOffsets = ref(new Map());

// 容器样式
const containerStyle = computed(() => ({
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
  overflow: 'auto',
  position: 'relative',
}));

// 获取项的唯一键
const getItemKey = (item) => {
  if (typeof props.itemKey === 'function') {
    return props.itemKey(item.data);
  }
  return item.data[props.itemKey] || item.index;
};

// 获取项高度
const getItemHeight = (index) => {
  if (props.itemHeight) {
    return props.itemHeight;
  }
  return itemHeights.value.get(index) || props.estimatedItemHeight;
};

// 计算总高度
const totalHeight = computed(() => {
  if (!props.enabled) {
    return props.items.length * props.estimatedItemHeight;
  }

  let height = 0;
  for (let i = 0; i < props.items.length; i++) {
    height += getItemHeight(i);
  }
  return height;
});

// 计算项偏移量
const calculateOffsets = () => {
  let offset = 0;
  for (let i = 0; i < props.items.length; i++) {
    itemOffsets.value.set(i, offset);
    offset += getItemHeight(i);
  }
};

// 查找起始索引（二分查找优化）
const findStartIndex = () => {
  if (!props.enabled) return 0;

  let left = 0;
  let right = props.items.length - 1;
  let result = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const offset = itemOffsets.value.get(mid) || 0;

    if (offset < scrollTop.value) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return Math.max(0, result - props.buffer);
};

// 查找结束索引
const findEndIndex = () => {
  if (!props.enabled) return props.items.length - 1;

  const viewportBottom = scrollTop.value + containerHeight.value;
  let index = findStartIndex();

  while (index < props.items.length) {
    const offset = itemOffsets.value.get(index) || 0;
    if (offset > viewportBottom) break;
    index++;
  }

  return Math.min(props.items.length - 1, index + props.buffer);
};

// 可见项
const visibleItems = computed(() => {
  if (!props.enabled) {
    return props.items.map((data, index) => ({ data, index }));
  }

  calculateOffsets();

  const startIndex = findStartIndex();
  const endIndex = findEndIndex();

  const items = [];
  for (let i = startIndex; i <= endIndex; i++) {
    if (i < props.items.length) {
      items.push({
        data: props.items[i],
        index: i,
      });
    }
  }

  return items;
});

// 偏移量
const offsetY = computed(() => {
  if (!props.enabled || visibleItems.value.length === 0) return 0;
  const firstIndex = visibleItems.value[0].index;
  return itemOffsets.value.get(firstIndex) || 0;
});

// 获取项样式
const getItemStyle = (item) => {
  return {
    minHeight: props.itemHeight ? `${props.itemHeight}px` : undefined,
  };
};

// 处理滚动
const handleScroll = (e) => {
  const target = e.target;
  scrollTop.value = target.scrollTop;
  containerHeight.value = target.clientHeight;

  emit('scroll', {
    scrollTop: scrollTop.value,
    scrollHeight: target.scrollHeight,
    clientHeight: target.clientHeight,
  });

  // 检查是否到达底部
  if (props.infiniteScroll) {
    const distanceToBottom = target.scrollHeight - scrollTop.value - containerHeight.value;
    if (distanceToBottom < props.infiniteScrollDistance) {
      emit('reach-bottom');
    }
  }

  // 检查是否到达顶部
  if (scrollTop.value < 10) {
    emit('reach-top');
  }

  // 触发可见项变化事件
  emit('visible-change', {
    startIndex: visibleItems.value[0]?.index || 0,
    endIndex: visibleItems.value[visibleItems.value.length - 1]?.index || 0,
    visibleItems: visibleItems.value,
  });
};

// 滚动到顶部
const scrollToTop = () => {
  if (containerRef.value) {
    containerRef.value.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }
};

// 滚动到指定索引
const scrollToIndex = (index, behavior = 'smooth') => {
  if (!containerRef.value || index < 0 || index >= props.items.length) return;

  calculateOffsets();
  const offset = itemOffsets.value.get(index) || 0;

  containerRef.value.scrollTo({
    top: offset,
    behavior,
  });
};

// 滚动到指定位置
const scrollTo = (top, behavior = 'smooth') => {
  if (containerRef.value) {
    containerRef.value.scrollTo({
      top,
      behavior,
    });
  }
};

// 更新项高度（动态高度模式）
const updateItemHeight = (index, height) => {
  if (props.itemHeight) return; // 固定高度模式不需要更新

  const oldHeight = itemHeights.value.get(index);
  if (oldHeight !== height) {
    itemHeights.value.set(index, height);
    calculateOffsets();
  }
};

// 测量所有项的高度（用于动态高度）
const measureItemHeights = async () => {
  if (props.itemHeight || !containerRef.value) return;

  await nextTick();

  const items = containerRef.value.querySelectorAll('.virtual-scroll-item');
  items.forEach((el, i) => {
    const index = visibleItems.value[i]?.index;
    if (index !== undefined) {
      const height = el.offsetHeight;
      updateItemHeight(index, height);
    }
  });
};

// 初始化
onMounted(() => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
  }

  // 动态高度模式下测量高度
  if (!props.itemHeight) {
    measureItemHeights();
  }
});

// 监听数据变化
watch(
  () => props.items,
  () => {
    itemHeights.value.clear();
    itemOffsets.value.clear();
    if (!props.itemHeight) {
      nextTick(() => measureItemHeights());
    }
  },
  { deep: true }
);

// 监听可见项变化，测量高度
watch(
  () => visibleItems.value,
  () => {
    if (!props.itemHeight) {
      nextTick(() => measureItemHeights());
    }
  },
  { deep: true }
);

// 暴露方法
defineExpose({
  scrollToTop,
  scrollToIndex,
  scrollTo,
  updateItemHeight,
  measureItemHeights,
});
</script>

<style scoped lang="scss">
.enhanced-virtual-scroll {
  position: relative;

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: #f0f0f0;
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #bfbfbf;
    border-radius: 4px;
    transition: background 0.2s;

    &:hover {
      background: #999;
    }
  }
}

.virtual-scroll-item {
  width: 100%;
}

.virtual-scroll-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: #8c8c8c;
  font-size: 14px;

  .loading-text {
    margin-left: 8px;
  }
}

.virtual-scroll-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  padding: 40px 20px;
}

.scroll-to-top {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1890ff;
  color: #ffffff;
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;

  &:hover {
    background: #40a9ff;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  &:active {
    transform: translateY(0);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// 暗色主题
.dark {
  .enhanced-virtual-scroll {
    &::-webkit-scrollbar-track {
      background: #1f1f1f;
    }

    &::-webkit-scrollbar-thumb {
      background: #3e3e3e;

      &:hover {
        background: #4e4e4e;
      }
    }
  }

  .virtual-scroll-loading {
    color: #bfbfbf;
  }

  .scroll-to-top {
    background: #177ddc;

    &:hover {
      background: #1890ff;
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .scroll-to-top {
    right: 12px;
    bottom: 12px;
    width: 36px;
    height: 36px;
  }
}
</style>
