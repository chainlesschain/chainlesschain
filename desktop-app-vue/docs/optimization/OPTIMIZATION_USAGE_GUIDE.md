# 优化功能使用指南

本文档介绍如何在项目中使用新实现的优化功能。

## 1. 骨架屏加载 (Skeleton Loading)

### 基础用法

```vue
<template>
  <div>
    <!-- 文件树加载骨架屏 -->
    <SkeletonLoader v-if="loading" type="file-tree" :rows="10" />
    <FileTree v-else :files="files" />

    <!-- 编辑器加载骨架屏 -->
    <SkeletonLoader v-if="editorLoading" type="editor" />
    <CodeEditor v-else :content="content" />

    <!-- 聊天消息加载骨架屏 -->
    <SkeletonLoader v-if="chatLoading" type="chat" :rows="5" />
    <ChatMessages v-else :messages="messages" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import SkeletonLoader from '@/components/common/SkeletonLoader.vue'

const loading = ref(true)

// 模拟数据加载
setTimeout(() => {
  loading.value = false
}, 1500)
</script>
```

### 可用的骨架屏类型

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| `file-tree` | 文件树骨架屏 | 文件浏览器 |
| `editor` | 编辑器骨架屏 | 代码编辑器 |
| `chat` | 聊天消息骨架屏 | AI 对话面板 |
| `card` | 卡片骨架屏 | 项目卡片列表 |
| `list` | 列表骨架屏 | 通用列表 |
| `generic` | 通用骨架屏 | 其他场景 |

### Props

- `type`: 骨架屏类型 (必填)
- `rows`: 行数 (默认: 5)
- `animated`: 是否启用动画 (默认: true)

---

## 2. 键盘快捷键系统

### 在组件中使用

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue'
import keyboardShortcuts from '@/utils/keyboard-shortcuts'

// 注册快捷键
onMounted(() => {
  keyboardShortcuts.register({
    key: 'Ctrl+E',
    description: '导出文件',
    scope: 'project-detail',
    handler: () => {
      console.log('导出文件')
      exportFile()
    }
  })

  // 设置当前作用域
  keyboardShortcuts.setScope('project-detail')
})

// 清理
onUnmounted(() => {
  keyboardShortcuts.unregister('Ctrl+E')
  keyboardShortcuts.setScope('global')
})
</script>
```

### 监听快捷键事件

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue'

const handleSave = () => {
  console.log('保存文件')
  // 保存逻辑
}

onMounted(() => {
  window.addEventListener('shortcut-save', handleSave)
})

onUnmounted(() => {
  window.removeEventListener('shortcut-save', handleSave)
})
</script>
```

### 内置快捷键列表

| 快捷键 | 功能 | 作用域 |
|--------|------|--------|
| `Ctrl+S` | 保存当前文件 | global |
| `Ctrl+F` | 在当前文件中查找 | global |
| `Ctrl+Shift+F` | 在项目中查找 | global |
| `Ctrl+P` | 打开命令面板 | global |
| `Ctrl+B` | 切换侧边栏 | global |
| `Ctrl+`` | 切换终端面板 | global |
| `Ctrl+/` | 切换注释 | global |
| `Ctrl+D` | 复制当前行 | editor |
| `Ctrl+Shift+K` | 删除当前行 | editor |
| `Alt+Up` | 向上移动行 | editor |
| `Alt+Down` | 向下移动行 | editor |
| `Ctrl+Z` | 撤销 | global |
| `Ctrl+Shift+Z` | 重做 | global |
| `Ctrl+N` | 新建文件 | global |
| `Ctrl+W` | 关闭当前标签 | global |
| `Ctrl+Tab` | 切换到下一个标签 | global |
| `Alt+1-9` | 切换到第 N 个标签 | global |
| `Esc` | 关闭弹窗/取消操作 | global |
| `F2` | 重命名 | global |

### API 文档

```javascript
// 注册快捷键
keyboardShortcuts.register({
  key: 'Ctrl+K',
  description: '命令描述',
  scope: 'global', // 作用域: global, editor, chat等
  preventDefault: true, // 是否阻止默认行为
  handler: () => {
    // 处理函数
  }
})

// 批量注册
keyboardShortcuts.registerMultiple([
  { key: 'Ctrl+1', handler: fn1 },
  { key: 'Ctrl+2', handler: fn2 }
])

// 注销快捷键
keyboardShortcuts.unregister('Ctrl+K')

// 设置作用域
keyboardShortcuts.setScope('editor')

// 启用/禁用快捷键
keyboardShortcuts.setEnabled(false)

// 显示命令面板
keyboardShortcuts.showCommandPalette()

// 获取所有命令
const commands = keyboardShortcuts.getAllCommands()
```

---

## 3. 命令面板 (Command Palette)

### 添加到项目

```vue
<template>
  <div class="app">
    <!-- 其他内容 -->

    <!-- 命令面板 -->
    <CommandPalette ref="commandPalette" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CommandPalette from '@/components/common/CommandPalette.vue'

const commandPalette = ref(null)

// 手动显示命令面板
const showPalette = () => {
  commandPalette.value?.show()
}
</script>
```

### 使用方式

1. **快捷键**: 按 `Ctrl+P` 打开命令面板
2. **搜索**: 输入关键词过滤命令
3. **导航**: 使用 `↑` `↓` 键选择命令
4. **执行**: 按 `Enter` 执行选中的命令
5. **关闭**: 按 `Esc` 关闭面板

---

## 4. CSS 性能优化建议

### 使用 CSS Containment

```css
/* 告诉浏览器元素的布局、样式和绘制独立 */
.file-tree-item {
  contain: layout style paint;
}

.editor-container {
  contain: layout;
}
```

### 使用 will-change

```css
/* 提示浏览器该元素将要变化 */
.animated-panel {
  will-change: transform, opacity;
}

/* 动画结束后移除 */
.animated-panel.animation-done {
  will-change: auto;
}
```

### 使用 transform 代替 position

```css
/* ❌ 不好 - 触发重排 */
.panel {
  left: 100px;
  top: 50px;
}

/* ✅ 好 - 只触发合成 */
.panel {
  transform: translate(100px, 50px);
}
```

### 优化选择器

```css
/* ❌ 不好 - 过于复杂 */
.project .sidebar .tree .item .icon {
  color: blue;
}

/* ✅ 好 - 简单直接 */
.tree-item-icon {
  color: blue;
}
```

### 使用 CSS Grid/Flexbox

```css
/* 现代布局系统,性能更好 */
.project-layout {
  display: grid;
  grid-template-columns: 250px 1fr 300px;
  grid-template-rows: auto 1fr;
  gap: 0;
}
```

---

## 4. 图片懒加载 (Image Lazy Loading)

### 基础用法 - LazyImage 组件

```vue
<template>
  <div>
    <!-- 基础用法 -->
    <LazyImage
      src="/path/to/image.jpg"
      alt="Description"
      :width="400"
      :height="300"
    />

    <!-- 带缩略图的渐进加载 -->
    <LazyImage
      src="/path/to/full-image.jpg"
      thumbnail="/path/to/thumbnail.jpg"
      :width="800"
      :height="600"
      :radius="8"
      fit="cover"
    />

    <!-- 高优先级图片（首屏） -->
    <LazyImage
      src="/hero-image.jpg"
      priority="high"
      :fade-in="true"
      @load="handleImageLoad"
      @error="handleImageError"
    />
  </div>
</template>

<script setup>
import LazyImage from '@/components/common/LazyImage.vue'

const handleImageLoad = (event) => {
  console.log('图片加载完成')
}

const handleImageError = (error) => {
  console.error('图片加载失败', error)
}
</script>
```

### 使用指令 - v-lazy

```vue
<template>
  <div>
    <!-- 简单用法 -->
    <img v-lazy="imageUrl" alt="Image" />

    <!-- 带配置 -->
    <img
      v-lazy="{
        src: imageUrl,
        lowRes: thumbnailUrl,
        priority: 'high'
      }"
      alt="Image"
    />

    <!-- 背景图片懒加载 -->
    <div
      v-lazy:background="backgroundImageUrl"
      class="hero-section"
    ></div>
  </div>
</template>

<script setup>
const imageUrl = ref('/path/to/image.jpg')
const thumbnailUrl = ref('/path/to/thumbnail.jpg')
const backgroundImageUrl = ref('/path/to/bg.jpg')
</script>
```

### LazyImage Props

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `src` | String | - | 图片 URL (必填) |
| `thumbnail` | String | '' | 缩略图 URL (用于渐进加载) |
| `alt` | String | '' | 图片描述 |
| `priority` | String | 'normal' | 加载优先级: 'high', 'normal', 'low' |
| `width` | String/Number | 'auto' | 宽度 |
| `height` | String/Number | 'auto' | 高度 |
| `fit` | String | 'cover' | object-fit 值 |
| `radius` | String/Number | 0 | 圆角半径 |
| `showLoader` | Boolean | true | 显示加载动画 |
| `showError` | Boolean | true | 显示错误信息 |
| `fadeIn` | Boolean | true | 淡入动画 |
| `allowRetry` | Boolean | true | 允许重试 |

### 性能优化建议

```javascript
import { getLazyLoader } from '@/utils/image-lazy-loader'

// 预加载关键图片（首屏）
const lazyLoader = getLazyLoader()
lazyLoader.preloadCritical([
  '/hero-image.jpg',
  '/logo.png',
  '/banner.jpg'
])

// 查看统计信息
const stats = lazyLoader.getStats()
console.log('图片加载统计:', stats)
// {
//   totalImages: 50,
//   loadedImages: 45,
//   failedImages: 2,
//   successRate: 90,
//   averageLoadTime: 856,
//   bandwidthSavedKB: 2048
// }
```

---

## 5. 请求批处理与去重 (Request Batching)

### 基础用法

```javascript
import { getRequestBatcher } from '@/utils/request-batcher'

const batcher = getRequestBatcher({
  batchWindow: 50, // 批处理窗口：50ms
  maxBatchSize: 10, // 每批最多10个请求
  enableCache: true,
  cacheTTL: 5 * 60 * 1000, // 缓存5分钟
})

// 单个请求（自动批处理和去重）
const result = await batcher.request('/api/users', { id: 123 })

// 跳过缓存
const freshData = await batcher.request(
  '/api/users',
  { id: 123 },
  { skipCache: true }
)

// 禁用批处理（立即执行）
const immediateResult = await batcher.request(
  '/api/users',
  { id: 123 },
  { enableBatching: false }
)
```

### 自定义批处理 API

```javascript
import RequestBatcher from '@/utils/request-batcher'

class MyRequestBatcher extends RequestBatcher {
  /**
   * 重写批处理 API 调用
   */
  async executeBatchAPI(endpoint, batchParams) {
    // 实现你的批量 API
    const response = await fetch(`${endpoint}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: batchParams })
    })

    const data = await response.json()
    return data.results // 返回结果数组
  }

  /**
   * 自定义批处理逻辑
   */
  isBatchable(endpoint) {
    // 只批处理 GET 请求
    return endpoint.includes('/api/') && !endpoint.includes('/auth/')
  }
}

// 使用自定义批处理器
const batcher = new MyRequestBatcher()
```

### 统计信息

```javascript
const stats = batcher.getStats()
console.log('请求统计:', stats)
// {
//   totalRequests: 100,
//   batchedRequests: 80,
//   cachedRequests: 15,
//   deduplicatedRequests: 20,
//   batchRate: '80%',
//   cacheHitRate: '15%',
//   averageResponseTime: 234,
//   bandwidthSavedKB: 512
// }
```

---

## 6. 组件懒加载 (Component Lazy Loading)

### 基础用法 - AsyncComponent

```vue
<template>
  <div>
    <!-- 使用 AsyncComponent 包装器 -->
    <AsyncComponent
      :loader="() => import('@/components/HeavyComponent.vue')"
      :delay="200"
      :timeout="10000"
      :show-progress="true"
      @loaded="handleLoaded"
      @error="handleError"
    >
      <!-- 自定义加载状态 -->
      <template #loading>
        <div class="custom-loading">
          <Spin size="large" />
          <p>Loading component...</p>
        </div>
      </template>

      <!-- 自定义错误状态 -->
      <template #error="{ error, retry }">
        <div class="custom-error">
          <p>{{ error.message }}</p>
          <a-button @click="retry">Retry</a-button>
        </div>
      </template>
    </AsyncComponent>
  </div>
</template>

<script setup>
import AsyncComponent from '@/components/common/AsyncComponent.vue'

const handleLoaded = (component) => {
  console.log('组件加载完成:', component)
}

const handleError = (error) => {
  console.error('组件加载失败:', error)
}
</script>
```

### 使用 lazyComponent 工具函数

```javascript
import { lazyComponent } from '@/utils/component-lazy-loader'

// 创建懒加载组件
const HeavyComponent = lazyComponent(
  () => import('@/components/HeavyComponent.vue'),
  {
    delay: 200,
    timeout: 10000,
  }
)

// 在组件中使用
export default {
  components: {
    HeavyComponent
  }
}
```

### 路由懒加载

```javascript
import { lazyRoutes } from '@/utils/component-lazy-loader'

const routes = lazyRoutes([
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/pages/Dashboard.vue')
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/pages/Profile.vue'),
    // 自定义加载组件
    loadingComponent: () => import('@/components/RouteLoading.vue')
  }
])

const router = createRouter({
  history: createWebHistory(),
  routes
})
```

### 预加载和预取

```javascript
import { getComponentLazyLoader } from '@/utils/component-lazy-loader'

const loader = getComponentLazyLoader()

// 预加载组件（在后台加载）
loader.prefetch(() => import('@/components/ExpensiveChart.vue'))

// 鼠标悬停时预取
const prefetchHandlers = loader.prefetchOnHover(
  () => import('@/components/Modal.vue')
)

// 在模板中使用
<button
  @mouseenter="prefetchHandlers.onMouseenter"
  @mouseleave="prefetchHandlers.onMouseleave"
>
  Open Modal
</button>

// 可见时预取（Intersection Observer）
const cleanup = loader.prefetchOnVisible(
  element,
  () => import('@/components/Footer.vue')
)

// 清理
onUnmounted(() => cleanup())
```

---

## 7. 乐观更新 (Optimistic Updates)

### 基础用法

```javascript
import { getOptimisticUpdateManager } from '@/utils/optimistic-update-manager'

const manager = getOptimisticUpdateManager()

// 执行乐观更新
const result = await manager.update({
  entity: 'post:123',

  // 立即更新本地状态
  mutation: async () => {
    post.value.likes += 1
    post.value.isLiked = true
  },

  // 后台调用 API
  apiCall: async () => {
    return await fetch('/api/posts/123/like', { method: 'POST' })
      .then(res => res.json())
  },

  // 可选：自定义回滚
  rollback: async (snapshot) => {
    post.value.likes = snapshot.likes
    post.value.isLiked = snapshot.isLiked
  },

  // 成功回调
  onSuccess: (result) => {
    console.log('点赞成功', result)
    showMessage('已点赞!')
  },

  // 失败回调
  onFailure: (error) => {
    console.error('点赞失败', error)
    showError('点赞失败，请重试')
  }
})
```

### 撤销/重做

```javascript
const manager = getOptimisticUpdateManager({
  enableUndoRedo: true,
  maxHistorySize: 50
})

// 执行操作
await manager.update({ /* ... */ })

// 撤销最后一次操作
await manager.undo()

// 重做
await manager.redo()

// 监听 Ctrl+Z / Ctrl+Shift+Z
keyboardShortcuts.register({
  key: 'Ctrl+Z',
  handler: () => manager.undo()
})

keyboardShortcuts.register({
  key: 'Ctrl+Shift+Z',
  handler: () => manager.redo()
})
```

### 批量操作

```javascript
// 批量更新（并行执行）
const results = await manager.batchUpdate([
  {
    entity: 'post:1',
    mutation: async () => { /* ... */ },
    apiCall: async () => { /* ... */ }
  },
  {
    entity: 'post:2',
    mutation: async () => { /* ... */ },
    apiCall: async () => { /* ... */ }
  },
  {
    entity: 'post:3',
    mutation: async () => { /* ... */ },
    apiCall: async () => { /* ... */ }
  }
])

console.log(`批量操作完成: ${results.filter(r => r.status === 'fulfilled').length} 成功`)
```

### 离线支持

```javascript
const manager = getOptimisticUpdateManager({
  enableOfflineQueue: true,
  retryOnFailure: true,
  maxRetries: 3
})

// 离线时，操作会被加入队列
await manager.update({
  entity: 'comment:456',
  mutation: async () => {
    comments.value.push(newComment)
  },
  apiCall: async () => {
    return await createComment(newComment)
  }
})

// 恢复在线时，自动处理离线队列
// 监听在线状态
window.addEventListener('online', () => {
  console.log('已恢复在线，正在同步...')
})
```

### 监听事件

```javascript
// 监听成功
manager.on('success', ({ updateId, entity, result }) => {
  console.log(`更新成功: ${entity}`, result)
})

// 监听失败
manager.on('failure', ({ updateId, entity, error }) => {
  console.error(`更新失败: ${entity}`, error)
  showNotification('操作失败，已自动回滚')
})

// 监听回滚
manager.on('rollback', ({ updateId, entity }) => {
  console.log(`已回滚: ${entity}`)
})

// 监听冲突
manager.on('conflict', (conflict) => {
  console.warn('检测到冲突:', conflict)
  showConflictDialog(conflict)
})
```

### 统计信息

```javascript
const stats = manager.getStats()
console.log('乐观更新统计:', stats)
// {
//   totalUpdates: 50,
//   successfulUpdates: 45,
//   failedUpdates: 3,
//   rolledBackUpdates: 3,
//   pendingUpdates: 2,
//   offlineQueueSize: 0,
//   undoStackSize: 10,
//   redoStackSize: 0,
//   isOnline: true
// }
```

---

## 8. 在 ProjectDetailPage 中集成

### 完整示例

```vue
<template>
  <div class="project-detail-page">
    <!-- 文件树骨架屏 -->
    <div class="sidebar">
      <SkeletonLoader
        v-if="fileTreeLoading"
        type="file-tree"
        :rows="15"
      />
      <EnhancedFileTree
        v-else
        :files="fileTree"
        @select="handleFileSelect"
      />
    </div>

    <!-- 编辑器骨架屏 -->
    <div class="editor-panel">
      <SkeletonLoader
        v-if="editorLoading"
        type="editor"
      />
      <CodeEditor
        v-else
        :content="currentFile.content"
        @save="handleSave"
      />
    </div>

    <!-- 聊天面板骨架屏 -->
    <div class="chat-panel">
      <SkeletonLoader
        v-if="chatLoading"
        type="chat"
        :rows="6"
      />
      <ChatPanel
        v-else
        :messages="messages"
        @send="handleSendMessage"
      />
    </div>

    <!-- 命令面板 -->
    <CommandPalette ref="commandPalette" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import SkeletonLoader from '@/components/common/SkeletonLoader.vue'
import CommandPalette from '@/components/common/CommandPalette.vue'
import keyboardShortcuts from '@/utils/keyboard-shortcuts'

const route = useRoute()
const projectId = route.params.id

// 加载状态
const fileTreeLoading = ref(true)
const editorLoading = ref(true)
const chatLoading = ref(true)

// 数据
const fileTree = ref([])
const currentFile = ref(null)
const messages = ref([])

// 引用
const commandPalette = ref(null)

// 加载数据
const loadProject = async () => {
  try {
    // 并行加载
    const [files, file, msgs] = await Promise.all([
      loadFileTree(projectId),
      loadCurrentFile(),
      loadChatMessages(projectId)
    ])

    fileTree.value = files
    currentFile.value = file
    messages.value = msgs
  } catch (error) {
    console.error('加载失败:', error)
  } finally {
    fileTreeLoading.value = false
    editorLoading.value = false
    chatLoading.value = false
  }
}

// 注册快捷键
const registerShortcuts = () => {
  // 保存文件
  window.addEventListener('shortcut-save', handleSave)

  // 查找
  window.addEventListener('shortcut-find', handleFind)

  // 切换侧边栏
  window.addEventListener('shortcut-toggle-sidebar', toggleSidebar)

  // 新建文件
  window.addEventListener('shortcut-new-file', createNewFile)

  // 关闭标签
  window.addEventListener('shortcut-close-tab', closeCurrentTab)

  // 切换标签
  window.addEventListener('shortcut-switch-tab', handleSwitchTab)

  // 设置作用域
  keyboardShortcuts.setScope('project-detail')
}

// 清理快捷键
const cleanupShortcuts = () => {
  window.removeEventListener('shortcut-save', handleSave)
  window.removeEventListener('shortcut-find', handleFind)
  window.removeEventListener('shortcut-toggle-sidebar', toggleSidebar)
  window.removeEventListener('shortcut-new-file', createNewFile)
  window.removeEventListener('shortcut-close-tab', closeCurrentTab)
  window.removeEventListener('shortcut-switch-tab', handleSwitchTab)

  keyboardShortcuts.setScope('global')
}

// 事件处理
const handleSave = () => {
  console.log('保存文件')
  // 保存逻辑
}

const handleFind = () => {
  console.log('查找')
  // 显示查找面板
}

const toggleSidebar = () => {
  console.log('切换侧边栏')
  // 切换侧边栏显示/隐藏
}

const createNewFile = () => {
  console.log('新建文件')
  // 新建文件逻辑
}

const closeCurrentTab = () => {
  console.log('关闭标签')
  // 关闭当前标签
}

const handleSwitchTab = (event) => {
  const { index } = event.detail
  console.log('切换到标签', index)
  // 切换标签逻辑
}

onMounted(() => {
  loadProject()
  registerShortcuts()
})

onUnmounted(() => {
  cleanupShortcuts()
})
</script>

<style scoped>
.project-detail-page {
  display: grid;
  grid-template-columns: 250px 1fr 300px;
  height: 100vh;
  gap: 0;
  /* 使用 CSS Containment */
  contain: layout style;
}

.sidebar,
.editor-panel,
.chat-panel {
  /* 独立的包含上下文 */
  contain: layout style paint;
  overflow: hidden;
}

/* 使用 transform 做动画 */
.sidebar {
  transform: translateX(0);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar.collapsed {
  transform: translateX(-100%);
}
</style>
```

---

## 性能优化检查清单

### ✅ 加载优化
- [ ] 使用骨架屏替代 loading 动画
- [ ] 并行加载独立数据
- [ ] 实现数据懒加载
- [ ] 启用 HTTP/2 或 HTTP/3

### ✅ 渲染优化
- [ ] 使用虚拟滚动处理长列表
- [ ] 使用 CSS Containment
- [ ] 避免强制同步布局
- [ ] 使用 transform 做动画
- [ ] 减少 DOM 节点数量

### ✅ 交互优化
- [ ] 实现键盘快捷键
- [ ] 使用防抖和节流
- [ ] 乐观更新 UI
- [ ] 提供即时反馈

### ✅ 代码优化
- [ ] 组件懒加载
- [ ] 代码分割
- [ ] Tree Shaking
- [ ] 压缩资源

---

## 调试技巧

### 1. 性能分析

```javascript
// 使用 Performance API
const mark = performance.mark('start-load')

// ... 执行操作 ...

performance.mark('end-load')
performance.measure('load-time', 'start-load', 'end-load')

const measure = performance.getEntriesByName('load-time')[0]
console.log('加载时间:', measure.duration, 'ms')
```

### 2. 查看快捷键

```javascript
// 在控制台查看所有注册的快捷键
import keyboardShortcuts from '@/utils/keyboard-shortcuts'

console.table(keyboardShortcuts.getAllCommands())
```

### 3. 检测布局抖动

```javascript
// 监听 layout shift
let cls = 0
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      cls += entry.value
      console.warn('Layout shift detected:', entry)
    }
  }
}).observe({ type: 'layout-shift', buffered: true })
```

---

## 常见问题

### Q: 骨架屏显示时间太短/太长?
A: 调整数据加载逻辑,确保骨架屏至少显示 300ms,最多 3 秒。

### Q: 快捷键冲突?
A: 使用作用域(scope)隔离不同页面的快捷键。

### Q: 命令面板搜索慢?
A: 命令列表已经优化,支持数千个命令的实时搜索。

### Q: CSS 优化后反而慢了?
A: 检查是否过度使用 will-change,它会占用额外内存。

---

## 下一步

查看更多优化功能:
- [预测性预加载](./PROJECT_DETAIL_ADVANCED_OPTIMIZATIONS.md#7-predictive-prefetching)
- [自适应性能调优](./PROJECT_DETAIL_ADVANCED_OPTIMIZATIONS.md#8-adaptive-performance-tuning)
- [高级分析](./PROJECT_DETAIL_ADVANCED_OPTIMIZATIONS.md#9-advanced-metrics-and-analytics)
