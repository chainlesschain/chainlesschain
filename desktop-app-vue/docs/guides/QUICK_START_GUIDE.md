# UI/UX优化组件快速开始指南

## 🚀 快速开始

本指南将帮助您快速上手使用新的UI/UX优化组件。

## 📦 组件列表

### 1. LoadingState - 统一加载状态组件

**位置**: `src/renderer/components/common/LoadingState.vue`

#### 基础用法

```vue
<template>
  <!-- 默认Spinner -->
  <LoadingState message="加载中..." />

  <!-- Skeleton骨架屏 -->
  <LoadingState
    type="skeleton"
    skeleton-type="file-tree"
    :skeleton-rows="10"
  />

  <!-- 进度条 -->
  <LoadingState
    type="progress"
    message="正在处理文件..."
    :progress="uploadProgress"
  />
</template>

<script setup>
import LoadingState from '@/components/common/LoadingState.vue';
import { ref } from 'vue';

const uploadProgress = ref(0);
</script>
```

#### 高级用法

```vue
<template>
  <!-- 全屏加载 -->
  <LoadingState
    v-if="initializing"
    type="spinner"
    message="应用初始化中..."
    :fullscreen="true"
  />

  <!-- 带进度的加载 -->
  <LoadingState
    type="progress"
    message="下载文件中..."
    sub-message="已完成 50/100 个文件"
    :progress="50"
    progress-status="active"
    :show-progress-info="true"
  />

  <!-- 自定义样式 -->
  <LoadingState
    type="dots"
    message="处理中，请稍候..."
  />
</template>
```

### 2. EnhancedErrorBoundary - 增强错误边界组件

**位置**: `src/renderer/components/common/EnhancedErrorBoundary.vue`

#### 基础用法

```vue
<template>
  <!-- 包裹可能出错的组件 -->
  <EnhancedErrorBoundary>
    <YourComponent />
  </EnhancedErrorBoundary>
</template>

<script setup>
import EnhancedErrorBoundary from '@/components/common/EnhancedErrorBoundary.vue';
</script>
```

#### 高级用法

```vue
<template>
  <!-- 自动重试 -->
  <EnhancedErrorBoundary
    :auto-retry="true"
    :max-retries="3"
    :retry-delay="3000"
    @error="handleError"
    @reset="handleReset"
    @report="handleReport"
  >
    <CriticalComponent />
  </EnhancedErrorBoundary>

  <!-- 全局错误边界 -->
  <EnhancedErrorBoundary
    :fullscreen="true"
    :show-home="true"
    :show-details="isDevelopment"
    error-title="应用加载失败"
    error-subtitle="无法加载应用，请检查网络连接"
    @go-home="router.push('/')"
  >
    <RouterView />
  </EnhancedErrorBoundary>
</template>

<script setup>
const isDevelopment = import.meta.env.DEV;

const handleError = ({ error, instance, info }) => {
  console.error('组件错误:', error);
  // 发送到错误追踪服务
};

const handleReset = () => {
  console.log('错误已重置');
};

const handleReport = (report) => {
  console.log('错误报告:', report);
  // 发送到服务器
};
</script>
```

### 3. EnhancedVirtualScroll - 增强虚拟滚动组件

**位置**: `src/renderer/components/common/EnhancedVirtualScroll.vue`

#### 基础用法

```vue
<template>
  <!-- 固定高度模式 -->
  <EnhancedVirtualScroll
    :items="messages"
    :item-height="60"
    height="600px"
  >
    <template #default="{ item, index }">
      <div class="message-item">
        <div class="message-index">{{ index }}</div>
        <div class="message-content">{{ item.content }}</div>
      </div>
    </template>
  </EnhancedVirtualScroll>
</template>

<script setup>
import EnhancedVirtualScroll from '@/components/common/EnhancedVirtualScroll.vue';
import { ref } from 'vue';

const messages = ref([
  { id: 1, content: 'Message 1' },
  { id: 2, content: 'Message 2' },
  // ... 更多数据
]);
</script>
```

#### 高级用法

```vue
<template>
  <!-- 动态高度 + 无限滚动 -->
  <EnhancedVirtualScroll
    ref="scrollRef"
    :items="messages"
    :estimated-item-height="80"
    :buffer="10"
    :infinite-scroll="true"
    :infinite-scroll-distance="100"
    :loading="loading"
    loading-text="加载更多..."
    empty-text="暂无消息"
    :show-scroll-top="true"
    @reach-bottom="loadMore"
    @reach-top="loadPrevious"
    @visible-change="handleVisibleChange"
  >
    <template #default="{ item }">
      <MessageCard :message="item" />
    </template>

    <template #empty>
      <a-empty description="还没有消息哦" />
    </template>
  </EnhancedVirtualScroll>
</template>

<script setup>
const scrollRef = ref(null);
const loading = ref(false);

const loadMore = async () => {
  loading.value = true;
  const newMessages = await fetchMessages();
  messages.value.push(...newMessages);
  loading.value = false;
};

// 滚动到指定消息
const scrollToMessage = (messageId) => {
  const index = messages.value.findIndex(m => m.id === messageId);
  if (index !== -1) {
    scrollRef.value.scrollToIndex(index);
  }
};
</script>
```

### 4. useResponsive - 响应式布局Composable

**位置**: `src/renderer/composables/useResponsive.js`

#### 基础用法

```vue
<template>
  <div>
    <!-- 设备类型检测 -->
    <div v-if="isMobile">移动端视图</div>
    <div v-else-if="isTablet">平板视图</div>
    <div v-else>桌面视图</div>

    <!-- 当前断点 -->
    <div>当前断点: {{ breakpoint }}</div>

    <!-- 屏幕尺寸 -->
    <div>宽度: {{ windowWidth }}px</div>
    <div>高度: {{ windowHeight }}px</div>
  </div>
</template>

<script setup>
import { useResponsive } from '@/composables/useResponsive';

const {
  isMobile,
  isTablet,
  isDesktop,
  breakpoint,
  windowWidth,
  windowHeight,
} = useResponsive();
</script>
```

#### 响应式网格

```vue
<template>
  <div :style="gridStyle">
    <div v-for="item in items" :key="item.id" class="grid-item">
      {{ item.name }}
    </div>
  </div>
</template>

<script setup>
import { useResponsiveGrid } from '@/composables/useResponsive';

const { gridStyle, currentColumns, currentGap } = useResponsiveGrid({
  columns: {
    xs: 1,
    sm: 2,
    md: 3,
    lg: 4,
    xl: 5,
    xxl: 6,
  },
  gap: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 24,
  },
});
</script>
```

#### 响应式面板

```vue
<template>
  <div class="layout">
    <!-- 侧边栏 -->
    <div :style="panelStyle" class="sidebar">
      <button @click="toggleCollapse">
        {{ isCollapsed ? '展开' : '折叠' }}
      </button>
      <div v-if="!isCollapsed">
        侧边栏内容
      </div>
    </div>

    <!-- 主内容 -->
    <div class="main-content">
      主要内容
    </div>
  </div>
</template>

<script setup>
import { useResponsivePanel } from '@/composables/useResponsive';

const {
  panelStyle,
  isCollapsed,
  toggleCollapse,
  expand,
  collapse,
} = useResponsivePanel({
  defaultWidth: {
    xs: '100%',
    sm: '100%',
    md: '300px',
    lg: '350px',
    xl: '400px',
  },
  minWidth: {
    md: 200,
    lg: 250,
    xl: 300,
  },
  collapsible: true,
});
</script>
```

### 5. usePerformanceWarning - 性能预警系统

**位置**: `src/renderer/utils/performance-warning.js`

#### 基础用法

```vue
<template>
  <div class="performance-panel">
    <!-- 性能指标 -->
    <div class="metrics">
      <div>FPS: {{ metrics.fps }}</div>
      <div>内存: {{ metrics.memory }} MB</div>
      <div>渲染时间: {{ metrics.renderTime }} ms</div>
    </div>

    <!-- 警告列表 -->
    <div class="warnings">
      <a-alert
        v-for="warning in warnings"
        :key="warning.id"
        :type="warning.level"
        :message="warning.message"
        :description="warning.suggestion"
        closable
        @close="clearWarning(warning.id)"
      />
    </div>

    <!-- 控制按钮 -->
    <a-space>
      <a-button @click="start">启动监控</a-button>
      <a-button @click="stop">停止监控</a-button>
      <a-button @click="clearAllWarnings">清除警告</a-button>
    </a-space>
  </div>
</template>

<script setup>
import { usePerformanceWarning } from '@/utils/performance-warning';
import { onMounted, onUnmounted } from 'vue';

const {
  warnings,
  metrics,
  enabled,
  start,
  stop,
  clearWarning,
  clearAllWarnings,
  getStats,
} = usePerformanceWarning();

onMounted(() => {
  start();
});

onUnmounted(() => {
  stop();
});
</script>
```

#### 高级用法

```vue
<script setup>
import { usePerformanceWarning, WARNING_TYPES, WARNING_LEVELS } from '@/utils/performance-warning';

const {
  addListener,
  setThreshold,
  setNotificationEnabled,
  exportHistory,
} = usePerformanceWarning();

// 监听警告
const unsubscribe = addListener((warning) => {
  console.log('性能警告:', warning);

  // 发送到分析服务
  if (warning.level === WARNING_LEVELS.CRITICAL) {
    sendToAnalytics(warning);
  }
});

// 自定义阈值
setThreshold(WARNING_TYPES.FPS, WARNING_LEVELS.WARNING, 45);
setThreshold(WARNING_TYPES.MEMORY, WARNING_LEVELS.CRITICAL, 600);

// 禁用通知
setNotificationEnabled(false);

// 导出历史
const exportData = () => {
  const history = exportHistory();
  console.log('性能历史:', history);
  // 下载或发送到服务器
};

onUnmounted(() => {
  unsubscribe();
});
</script>
```

## 🎯 最佳实践

### 1. 加载状态

```vue
<!-- ✅ 推荐：使用skeleton提升感知速度 -->
<LoadingState
  v-if="loading"
  type="skeleton"
  skeleton-type="file-tree"
/>
<FileTree v-else :files="files" />

<!-- ❌ 避免：长时间spinner无反馈 -->
<LoadingState v-if="loading" type="spinner" />
```

### 2. 错误处理

```vue
<!-- ✅ 推荐：包裹关键组件 -->
<EnhancedErrorBoundary :auto-retry="true">
  <CriticalDataComponent />
</EnhancedErrorBoundary>

<!-- ✅ 推荐：全局错误边界 -->
<EnhancedErrorBoundary :fullscreen="true" :show-home="true">
  <App />
</EnhancedErrorBoundary>
```

### 3. 虚拟滚动

```vue
<!-- ✅ 推荐：大列表使用虚拟滚动 -->
<EnhancedVirtualScroll
  v-if="items.length > 100"
  :items="items"
  :item-height="60"
/>

<!-- ❌ 避免：小列表使用虚拟滚动 -->
<EnhancedVirtualScroll
  v-if="items.length < 20"
  :items="items"
/>
```

### 4. 响应式设计

```vue
<!-- ✅ 推荐：使用composable -->
<script setup>
const { isMobile, gridStyle } = useResponsive();
</script>

<template>
  <div :style="gridStyle">
    <!-- 内容 -->
  </div>
</template>

<!-- ❌ 避免：手动媒体查询 -->
<style>
@media (max-width: 768px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
```

## 🔧 常见问题

### Q1: 虚拟滚动组件如何处理动态高度？

```vue
<EnhancedVirtualScroll
  :items="items"
  :estimated-item-height="80"  <!-- 提供估算高度 -->
  :item-height="null"           <!-- 不设置固定高度 -->
>
  <template #default="{ item }">
    <!-- 组件会自动测量实际高度 -->
    <DynamicHeightItem :item="item" />
  </template>
</EnhancedVirtualScroll>
```

### Q2: 如何在错误边界中访问子组件？

```vue
<EnhancedErrorBoundary
  @error="handleError"
>
  <YourComponent ref="childRef" />
</EnhancedErrorBoundary>

<script setup>
const childRef = ref(null);

const handleError = ({ error, instance }) => {
  // instance 就是子组件实例
  console.log('子组件:', instance);
};
</script>
```

### Q3: 如何自定义性能预警阈值？

```javascript
import { usePerformanceWarning, WARNING_TYPES, WARNING_LEVELS } from '@/utils/performance-warning';

const { setThreshold } = usePerformanceWarning();

// 设置FPS警告阈值为45
setThreshold(WARNING_TYPES.FPS, WARNING_LEVELS.WARNING, 45);

// 设置内存严重阈值为600MB
setThreshold(WARNING_TYPES.MEMORY, WARNING_LEVELS.CRITICAL, 600);
```

## 📚 更多资源

- [完整文档](./UI_UX_OPTIMIZATION_SUMMARY.md)
- [API参考](./API_REFERENCE.md)
- [示例代码](../examples/)
- [性能优化指南](./PERFORMANCE_OPTIMIZATION.md)

## 🤝 贡献

欢迎提交Issue和Pull Request！

---

**最后更新**: 2026-01-11
