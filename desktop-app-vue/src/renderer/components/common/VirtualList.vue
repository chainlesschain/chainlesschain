<template>
  <div
    ref="containerRef"
    class="virtual-list-container"
    :style="containerStyle"
    @scroll="handleScroll"
  >
    <div class="virtual-list-phantom" :style="phantomStyle" />
    <div class="virtual-list-content" :style="contentStyle">
      <div
        v-for="item in visibleItems"
        :key="getItemKey(item.data)"
        class="virtual-list-item"
        :style="{ height: `${itemHeight}px` }"
      >
        <slot :item="item.data" :index="item.index" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";

const props = defineProps({
  // 数据列表
  items: {
    type: Array,
    required: true,
  },
  // 每个项目的固定高度（单位：px）
  itemHeight: {
    type: Number,
    default: 50,
  },
  // 容器高度（单位：px）- 不设置时自动计算
  height: {
    type: [Number, String],
    default: null,
  },
  // 缓冲区大小（上下各缓冲的项目数）
  buffer: {
    type: Number,
    default: 5,
  },
  // 获取项目唯一标识的函数或字段名
  itemKey: {
    type: [Function, String],
    default: "id",
  },
  // 是否启用滚动节流
  throttle: {
    type: Boolean,
    default: true,
  },
  // 节流延迟（毫秒）
  throttleDelay: {
    type: Number,
    default: 16,
  },
});

const emit = defineEmits(["scroll", "reach-top", "reach-bottom"]);

// 容器引用
const containerRef = ref(null);

// 滚动状态
const scrollTop = ref(0);
const containerHeight = ref(0);

// 安全获取 items 数组
const safeItems = computed(() => props.items || []);

// 计算属性
const totalHeight = computed(() => safeItems.value.length * props.itemHeight);

// 可见区域的起始和结束索引
const visibleRange = computed(() => {
  const start = Math.floor(scrollTop.value / props.itemHeight);
  const visibleCount = Math.ceil(containerHeight.value / props.itemHeight);
  const end = start + visibleCount;

  // 添加缓冲区
  const bufferedStart = Math.max(0, start - props.buffer);
  const bufferedEnd = Math.min(safeItems.value.length, end + props.buffer);

  return { start: bufferedStart, end: bufferedEnd };
});

// 可见项目列表
const visibleItems = computed(() => {
  const { start, end } = visibleRange.value;
  return safeItems.value.slice(start, end).map((data, i) => ({
    data,
    index: start + i,
  }));
});

// 样式计算
const containerStyle = computed(() => ({
  height:
    typeof props.height === "number"
      ? `${props.height}px`
      : props.height || "100%",
  overflow: "auto",
  position: "relative",
}));

const phantomStyle = computed(() => ({
  height: `${totalHeight.value}px`,
  position: "absolute",
  left: 0,
  top: 0,
  right: 0,
  zIndex: -1,
}));

const contentStyle = computed(() => ({
  position: "absolute",
  left: 0,
  right: 0,
  top: `${visibleRange.value.start * props.itemHeight}px`,
}));

// 获取项目唯一标识
const getItemKey = (item) => {
  if (typeof props.itemKey === "function") {
    return props.itemKey(item);
  }
  return item[props.itemKey] ?? item;
};

// 滚动节流
let scrollThrottleTimer = null;
const handleScroll = (event) => {
  if (props.throttle) {
    if (scrollThrottleTimer) {
      return;
    }
    scrollThrottleTimer = setTimeout(() => {
      updateScroll(event);
      scrollThrottleTimer = null;
    }, props.throttleDelay);
  } else {
    updateScroll(event);
  }
};

const updateScroll = (event) => {
  if (!containerRef.value) {
    return;
  }

  const { scrollTop: st, scrollHeight, clientHeight } = containerRef.value;
  scrollTop.value = st;

  emit("scroll", { scrollTop: st, scrollHeight, clientHeight });

  // 检测是否到达顶部或底部
  if (st === 0) {
    emit("reach-top");
  }
  if (st + clientHeight >= scrollHeight - 10) {
    emit("reach-bottom");
  }
};

// 更新容器高度
const updateContainerHeight = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
  }
};

// 滚动到指定索引
const scrollToIndex = (index, behavior = "auto") => {
  if (!containerRef.value) {
    return;
  }
  const offset = index * props.itemHeight;
  containerRef.value.scrollTo({ top: offset, behavior });
};

// 滚动到顶部
const scrollToTop = (behavior = "auto") => {
  scrollToIndex(0, behavior);
};

// 滚动到底部
const scrollToBottom = (behavior = "auto") => {
  if (!containerRef.value) {
    return;
  }
  containerRef.value.scrollTo({ top: totalHeight.value, behavior });
};

// 监听数据变化
watch(
  () => props.items.length,
  () => {
    nextTick(updateContainerHeight);
  },
);

// 监听高度属性变化
watch(
  () => props.height,
  () => {
    nextTick(updateContainerHeight);
  },
);

// ResizeObserver
let resizeObserver = null;

onMounted(() => {
  updateContainerHeight();

  // 使用 ResizeObserver 监听容器大小变化
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      updateContainerHeight();
    });
    if (containerRef.value) {
      resizeObserver.observe(containerRef.value);
    }
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (scrollThrottleTimer) {
    clearTimeout(scrollThrottleTimer);
  }
});

// 暴露方法给父组件
defineExpose({
  scrollToIndex,
  scrollToTop,
  scrollToBottom,
  getScrollTop: () => scrollTop.value,
  getContainerHeight: () => containerHeight.value,
});
</script>

<style scoped>
.virtual-list-container {
  will-change: transform;
}

.virtual-list-content {
  will-change: transform;
}

.virtual-list-item {
  box-sizing: border-box;
}
</style>
