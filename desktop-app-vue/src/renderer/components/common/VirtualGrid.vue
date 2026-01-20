<template>
  <div ref="containerRef" class="virtual-grid" @scroll="handleScroll">
    <!-- 加载状态 -->
    <div v-if="loading && items.length === 0" class="virtual-grid-loading">
      <a-spin size="large" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!loading && items.length === 0" class="virtual-grid-empty">
      <slot name="empty">
        <a-empty :description="emptyText" />
      </slot>
    </div>

    <!-- 虚拟滚动内容 -->
    <template v-else>
      <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
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
            v-for="(item, index) in visibleItems"
            :key="getItemKey(item)"
            class="virtual-grid-item"
            :style="itemStyle"
          >
            <slot :item="item" :index="startIndex + index" />
          </div>
        </div>
      </div>

      <!-- 加载更多指示器 -->
      <div v-if="loading && items.length > 0" class="virtual-grid-loading-more">
        <a-spin size="small" />
        <span>加载中...</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  itemHeight: {
    type: Number,
    default: 250,
  },
  // 支持固定列数或响应式配置
  columns: {
    type: [Number, Object],
    default: 3,
  },
  // 响应式断点配置 { xs: 1, sm: 2, md: 3, lg: 4, xl: 4, xxl: 6 }
  responsive: {
    type: Object,
    default: null,
  },
  gap: {
    type: Number,
    default: 16,
  },
  itemKey: {
    type: [String, Function],
    default: "id",
  },
  // 缓冲行数
  buffer: {
    type: Number,
    default: 2,
  },
  // 是否正在加载
  loading: {
    type: Boolean,
    default: false,
  },
  // 空状态文本
  emptyText: {
    type: String,
    default: "暂无数据",
  },
  // 无限滚动
  infiniteScroll: {
    type: Boolean,
    default: false,
  },
  // 触发加载更多的阈值
  loadMoreThreshold: {
    type: Number,
    default: 100,
  },
});

const emit = defineEmits(["scroll", "load-more", "reach-top", "reach-bottom"]);

const containerRef = ref(null);
const scrollTop = ref(0);
const containerHeight = ref(0);
const containerWidth = ref(0);

// 获取项目键值
const getItemKey = (item) => {
  if (typeof props.itemKey === "function") {
    return props.itemKey(item);
  }
  return item[props.itemKey] ?? item;
};

// 响应式列数计算
const itemsPerRow = computed(() => {
  // 使用响应式配置
  if (props.responsive) {
    const width = containerWidth.value;
    if (width >= 1600) {
      return props.responsive.xxl || 6;
    }
    if (width >= 1200) {
      return props.responsive.xl || 4;
    }
    if (width >= 992) {
      return props.responsive.lg || 4;
    }
    if (width >= 768) {
      return props.responsive.md || 3;
    }
    if (width >= 576) {
      return props.responsive.sm || 2;
    }
    return props.responsive.xs || 1;
  }
  // 使用固定列数
  if (typeof props.columns === "number") {
    return props.columns;
  }
  // 支持对象形式的 columns 配置作为响应式
  if (typeof props.columns === "object") {
    const width = containerWidth.value;
    if (width >= 1600) {
      return props.columns.xxl || 6;
    }
    if (width >= 1200) {
      return props.columns.xl || 4;
    }
    if (width >= 992) {
      return props.columns.lg || 4;
    }
    if (width >= 768) {
      return props.columns.md || 3;
    }
    if (width >= 576) {
      return props.columns.sm || 2;
    }
    return props.columns.xs || 1;
  }
  return 3;
});

// 计算总行数
const totalRows = computed(() =>
  Math.ceil(props.items.length / itemsPerRow.value),
);

// 计算总高度
const totalHeight = computed(() => {
  return totalRows.value * (props.itemHeight + props.gap);
});

// 计算可见区域的起始行
const startRow = computed(() => {
  return Math.max(
    0,
    Math.floor(scrollTop.value / (props.itemHeight + props.gap)) - props.buffer,
  );
});

// 计算可见区域的结束行
const endRow = computed(() => {
  const visibleRows = Math.ceil(
    containerHeight.value / (props.itemHeight + props.gap),
  );
  return Math.min(
    startRow.value + visibleRows + props.buffer * 2,
    totalRows.value,
  );
});

// 计算可见项的起始索引
const startIndex = computed(() => startRow.value * itemsPerRow.value);

// 计算可见项的结束索引
const endIndex = computed(() =>
  Math.min(endRow.value * itemsPerRow.value, props.items.length),
);

// 计算可见项
const visibleItems = computed(() => {
  return props.items.slice(startIndex.value, endIndex.value);
});

// 计算偏移量
const offsetY = computed(() => {
  return startRow.value * (props.itemHeight + props.gap);
});

// 计算每个项的样式
const itemStyle = computed(() => ({
  height: `${props.itemHeight}px`,
  marginBottom: `${props.gap}px`,
  width: `calc((100% - ${(itemsPerRow.value - 1) * props.gap}px) / ${itemsPerRow.value})`,
  display: "inline-block",
  marginRight: `${props.gap}px`,
  verticalAlign: "top",
  boxSizing: "border-box",
}));

// 滚动节流
let scrollRafId = null;
const handleScroll = (e) => {
  if (scrollRafId) {
    return;
  }
  scrollRafId = requestAnimationFrame(() => {
    updateScroll(e);
    scrollRafId = null;
  });
};

const updateScroll = (e) => {
  const { scrollTop: st, scrollHeight, clientHeight } = e.target;
  scrollTop.value = st;

  emit("scroll", { scrollTop: st, scrollHeight, clientHeight });

  // 检测到达顶部
  if (st === 0) {
    emit("reach-top");
  }

  // 检测到达底部 / 无限滚动加载
  if (st + clientHeight >= scrollHeight - props.loadMoreThreshold) {
    emit("reach-bottom");
    if (props.infiniteScroll && !props.loading) {
      emit("load-more");
    }
  }
};

// 更新容器尺寸
const updateContainerSize = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
    containerWidth.value = containerRef.value.clientWidth;
  }
};

// 滚动到指定索引
const scrollToIndex = (index, behavior = "auto") => {
  if (!containerRef.value) {
    return;
  }
  const row = Math.floor(index / itemsPerRow.value);
  const offset = row * (props.itemHeight + props.gap);
  containerRef.value.scrollTo({ top: offset, behavior });
};

// 滚动到顶部
const scrollToTop = (behavior = "auto") => {
  if (!containerRef.value) {
    return;
  }
  containerRef.value.scrollTo({ top: 0, behavior });
};

// 滚动到底部
const scrollToBottom = (behavior = "auto") => {
  if (!containerRef.value) {
    return;
  }
  containerRef.value.scrollTo({ top: totalHeight.value, behavior });
};

// ResizeObserver
let resizeObserver = null;

onMounted(() => {
  updateContainerSize();

  // 使用 ResizeObserver 监听容器大小变化（比 window resize 更精确）
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      updateContainerSize();
    });
    if (containerRef.value) {
      resizeObserver.observe(containerRef.value);
    }
  } else {
    // 降级到 window resize
    window.addEventListener("resize", updateContainerSize);
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  } else {
    window.removeEventListener("resize", updateContainerSize);
  }
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId);
  }
});

// 监听 items 变化
watch(
  () => props.items.length,
  (newLen, oldLen) => {
    // 如果是首次加载数据，重置滚动位置
    if (oldLen === 0 && newLen > 0) {
      nextTick(() => {
        if (containerRef.value) {
          containerRef.value.scrollTop = 0;
          scrollTop.value = 0;
        }
      });
    }
  },
);

// 暴露方法给父组件
defineExpose({
  scrollToIndex,
  scrollToTop,
  scrollToBottom,
  getScrollTop: () => scrollTop.value,
  getColumnsPerRow: () => itemsPerRow.value,
  refresh: updateContainerSize,
});
</script>

<style scoped lang="scss">
.virtual-grid {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  will-change: transform;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: #bfbfbf;
    border-radius: 4px;

    &:hover {
      background: #999;
    }
  }

  &::-webkit-scrollbar-track {
    background: #f0f0f0;
  }
}

.virtual-grid-item {
  box-sizing: border-box;
}

.virtual-grid-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

.virtual-grid-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

.virtual-grid-loading-more {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: #999;
}
</style>
