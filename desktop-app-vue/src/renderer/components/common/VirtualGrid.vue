<template>
  <div ref="containerRef" class="virtual-grid" @scroll="handleScroll">
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
          :key="item[itemKey]"
          class="virtual-grid-item"
          :style="itemStyle"
        >
          <slot :item="item" :index="startIndex + index" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  itemHeight: {
    type: Number,
    default: 250, // 技能卡片默认高度
  },
  columns: {
    type: Number,
    default: 3, // 默认3列
  },
  gap: {
    type: Number,
    default: 16, // 默认间距
  },
  itemKey: {
    type: String,
    default: 'id',
  },
});

const containerRef = ref(null);
const scrollTop = ref(0);
const containerHeight = ref(0);

// 计算每行显示的项数
const itemsPerRow = computed(() => props.columns);

// 计算总行数
const totalRows = computed(() => Math.ceil(props.items.length / itemsPerRow.value));

// 计算总高度
const totalHeight = computed(() => {
  return totalRows.value * (props.itemHeight + props.gap);
});

// 计算可见区域的起始行
const startRow = computed(() => {
  return Math.floor(scrollTop.value / (props.itemHeight + props.gap));
});

// 计算可见区域的结束行（多渲染2行以实现平滑滚动）
const endRow = computed(() => {
  const visibleRows = Math.ceil(containerHeight.value / (props.itemHeight + props.gap));
  return Math.min(startRow.value + visibleRows + 2, totalRows.value);
});

// 计算可见项的起始索引
const startIndex = computed(() => startRow.value * itemsPerRow.value);

// 计算可见项的结束索引
const endIndex = computed(() => Math.min(endRow.value * itemsPerRow.value, props.items.length));

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
  display: 'inline-block',
  marginRight: `${props.gap}px`,
  verticalAlign: 'top',
}));

// 处理滚动事件
const handleScroll = (e) => {
  scrollTop.value = e.target.scrollTop;
};

// 更新容器高度
const updateContainerHeight = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
  }
};

// 监听窗口大小变化
const handleResize = () => {
  updateContainerHeight();
};

onMounted(() => {
  updateContainerHeight();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});

// 监听items变化，重置滚动位置
watch(() => props.items, () => {
  if (containerRef.value) {
    containerRef.value.scrollTop = 0;
    scrollTop.value = 0;
  }
});
</script>

<style scoped lang="scss">
.virtual-grid {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;

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
</style>
