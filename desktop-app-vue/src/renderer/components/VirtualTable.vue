<template>
  <div class="virtual-table-wrapper">
    <!-- 表头 -->
    <div class="virtual-table-header">
      <table>
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              :style="{ width: column.width }"
            >
              {{ column.title }}
            </th>
          </tr>
        </thead>
      </table>
    </div>

    <!-- 虚拟滚动容器 -->
    <div
      ref="scrollContainer"
      class="virtual-table-body"
      :style="{ height: containerHeight }"
      @scroll="handleScroll"
    >
      <!-- 占位元素（用于撑开总高度） -->
      <div :style="{ height: totalHeight + 'px', position: 'relative' }">
        <!-- 可见区域的表格 -->
        <table :style="{ transform: `translateY(${offsetY}px)` }">
          <tbody>
            <tr
              v-for="item in visibleItems"
              :key="rowKey(item)"
              :class="{ 'row-hover': hoveredRowKey === rowKey(item) }"
              @mouseenter="hoveredRowKey = rowKey(item)"
              @mouseleave="hoveredRowKey = null"
            >
              <td
                v-for="column in columns"
                :key="column.key"
                :style="{ width: column.width }"
              >
                <slot
                  :name="`cell-${column.key}`"
                  :record="item"
                  :column="column"
                >
                  {{ item[column.dataIndex] }}
                </slot>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="dataSource.length === 0 && !loading" class="virtual-table-empty">
      <a-empty description="暂无数据" />
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="virtual-table-loading">
      <a-spin tip="加载中..." />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { Empty, Spin } from "ant-design-vue";

const props = defineProps({
  columns: {
    type: Array,
    required: true,
  },
  dataSource: {
    type: Array,
    default: () => [],
  },
  rowKey: {
    type: Function,
    default: (record) => record.id,
  },
  rowHeight: {
    type: Number,
    default: 54, // 默认行高
  },
  containerHeight: {
    type: String,
    default: "600px",
  },
  loading: {
    type: Boolean,
    default: false,
  },
  // 缓冲区大小（渲染可见区域上下额外的行数）
  bufferSize: {
    type: Number,
    default: 5,
  },
});

// 状态
const scrollContainer = ref(null);
const scrollTop = ref(0);
const hoveredRowKey = ref(null);

// 计算属性

// 总高度
const totalHeight = computed(() => {
  return props.dataSource.length * props.rowHeight;
});

// 容器可见高度
const containerVisibleHeight = computed(() => {
  return parseInt(props.containerHeight) || 600;
});

// 可见区域可以容纳的行数
const visibleCount = computed(() => {
  return Math.ceil(containerVisibleHeight.value / props.rowHeight);
});

// 开始索引（带缓冲区）
const startIndex = computed(() => {
  const index = Math.floor(scrollTop.value / props.rowHeight);
  return Math.max(0, index - props.bufferSize);
});

// 结束索引（带缓冲区）
const endIndex = computed(() => {
  const index = startIndex.value + visibleCount.value + props.bufferSize * 2;
  return Math.min(props.dataSource.length, index);
});

// 可见区域的数据
const visibleItems = computed(() => {
  return props.dataSource.slice(startIndex.value, endIndex.value);
});

// 偏移量（用于定位可见区域）
const offsetY = computed(() => {
  return startIndex.value * props.rowHeight;
});

// 方法

// 处理滚动事件
function handleScroll(event) {
  scrollTop.value = event.target.scrollTop;
}

// 滚动到指定索引
function scrollToIndex(index) {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = index * props.rowHeight;
  }
}

// 滚动到顶部
function scrollToTop() {
  scrollToIndex(0);
}

// 暴露方法给父组件
defineExpose({
  scrollToIndex,
  scrollToTop,
});

// 监听数据源变化，重置滚动位置
watch(
  () => props.dataSource.length,
  (newLength, oldLength) => {
    // 如果数据源完全改变（比如切换设备），重置滚动
    if (oldLength > 0 && newLength !== oldLength) {
      scrollToTop();
    }
  },
);
</script>

<style scoped>
.virtual-table-wrapper {
  border: 1px solid #f0f0f0;
  border-radius: 2px;
  overflow: hidden;
}

.virtual-table-header {
  overflow: hidden;
  background-color: #fafafa;
  border-bottom: 1px solid #f0f0f0;
}

.virtual-table-header table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}

.virtual-table-header th {
  padding: 16px;
  text-align: left;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.85);
  background-color: #fafafa;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.virtual-table-body {
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}

.virtual-table-body table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  position: absolute;
  top: 0;
  left: 0;
}

.virtual-table-body tr {
  transition: background-color 0.2s;
}

.virtual-table-body tr:hover,
.virtual-table-body tr.row-hover {
  background-color: #fafafa;
}

.virtual-table-body td {
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.virtual-table-empty {
  padding: 64px 0;
  text-align: center;
  background-color: #fff;
}

.virtual-table-loading {
  padding: 64px 0;
  text-align: center;
  background-color: #fff;
}

/* 自定义滚动条样式 */
.virtual-table-body::-webkit-scrollbar {
  width: 8px;
}

.virtual-table-body::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.virtual-table-body::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

.virtual-table-body::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
