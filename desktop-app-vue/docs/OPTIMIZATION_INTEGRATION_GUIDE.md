# 优化功能集成指南

本文档提供完整的集成示例，展示如何在 ProjectDetailPage 中使用所有优化功能。

---

## 📋 集成清单

### 必需步骤

- [ ] 安装依赖（pako）
- [ ] 注册全局组件和指令
- [ ] 初始化优化管理器
- [ ] 集成骨架屏
- [ ] 启用键盘快捷键
- [ ] 应用图片懒加载
- [ ] 启用请求批处理
- [ ] 使用组件懒加载
- [ ] 实现乐观更新
- [ ] 添加动画效果
- [ ] 集成性能监控面板

---

## 1. 安装依赖

```bash
cd desktop-app-vue
npm install pako  # 用于数据压缩
```

---

## 2. 全局注册（main.js / renderer.js）

```javascript
// desktop-app-vue/src/renderer/main.js 或 renderer.js

import { createApp } from 'vue'
import App from './App.vue'

// 导入优化组件
import SkeletonLoader from '@/components/common/SkeletonLoader.vue'
import LazyImage from '@/components/common/LazyImage.vue'
import AsyncComponent from '@/components/common/AsyncComponent.vue'
import CommandPalette from '@/components/common/CommandPalette.vue'
import PerformanceMonitor from '@/components/common/PerformanceMonitor.vue'

// 导入过渡组件
import FadeSlide from '@/components/common/transitions/FadeSlide.vue'
import ScaleTransition from '@/components/common/transitions/ScaleTransition.vue'
import CollapseTransition from '@/components/common/transitions/CollapseTransition.vue'

// 导入指令
import lazyLoadDirective from '@/directives/lazy-load'

// 导入工具函数
import keyboardShortcuts from '@/utils/keyboard-shortcuts'

const app = createApp(App)

// 注册全局组件
app.component('SkeletonLoader', SkeletonLoader)
app.component('LazyImage', LazyImage)
app.component('AsyncComponent', AsyncComponent)
app.component('CommandPalette', CommandPalette)
app.component('PerformanceMonitor', PerformanceMonitor)
app.component('FadeSlide', FadeSlide)
app.component('ScaleTransition', ScaleTransition)
app.component('CollapseTransition', CollapseTransition)

// 注册全局指令
app.directive('lazy', lazyLoadDirective)

// 初始化键盘快捷键（全局）
// 默认快捷键已在 keyboard-shortcuts.js 中注册

// 挂载应用
app.mount('#app')

console.log('[App] Optimizations initialized')
```

---

## 3. ProjectDetailPage 完整集成示例

```vue
<template>
  <div class="project-detail-page-optimized">
    <!-- 性能监控面板（开发环境） -->
    <PerformanceMonitor v-if="isDevelopment" />

    <!-- 命令面板 -->
    <CommandPalette ref="commandPalette" />

    <!-- 顶部工具栏 - 使用 FadeSlide 过渡 -->
    <FadeSlide direction="down" :duration="300" appear>
      <div class="toolbar">
        <!-- 工具栏内容 -->
        <div class="toolbar-left">
          <a-breadcrumb>
            <a-breadcrumb-item>
              <a @click="handleBackToList">
                <FolderOpenOutlined />
                我的项目
              </a>
            </a-breadcrumb-item>
            <a-breadcrumb-item v-if="currentProject">
              {{ currentProject.name }}
            </a-breadcrumb-item>
          </a-breadcrumb>
        </div>

        <div class="toolbar-right">
          <!-- 操作按钮 -->
        </div>
      </div>
    </FadeSlide>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧：文件树 -->
      <div class="file-tree-panel">
        <!-- 骨架屏 -->
        <SkeletonLoader
          v-if="fileTreeLoading"
          type="file-tree"
          :rows="15"
        />

        <!-- 文件树（使用 FadeSlide 过渡） -->
        <FadeSlide v-else direction="right">
          <EnhancedFileTree
            :files="fileTree"
            @select="handleFileSelect"
          />
        </FadeSlide>
      </div>

      <!-- 中间：编辑器 -->
      <div class="editor-panel">
        <!-- 骨架屏 -->
        <SkeletonLoader
          v-if="editorLoading"
          type="editor"
        />

        <!-- 编辑器（懒加载组件） -->
        <AsyncComponent
          v-else
          :loader="() => import('@/components/projects/CodeEditor.vue')"
          :delay="200"
          @loaded="handleEditorLoaded"
        >
          <template #loading>
            <SkeletonLoader type="editor" />
          </template>
        </AsyncComponent>
      </div>

      <!-- 右侧：聊天面板 -->
      <div class="chat-panel">
        <!-- 骨架屏 -->
        <SkeletonLoader
          v-if="chatLoading"
          type="chat"
          :rows="6"
        />

        <!-- 聊天面板 -->
        <div v-else class="chat-container">
          <!-- 消息列表（虚拟滚动） -->
          <VirtualMessageList
            :messages="messages"
            @send="handleSendMessage"
          />

          <!-- 图片消息使用懒加载 -->
          <div v-for="msg in messages" :key="msg.id" class="message">
            <LazyImage
              v-if="msg.type === 'image'"
              :src="msg.imageUrl"
              :thumbnail="msg.thumbnailUrl"
              :width="200"
              :height="200"
              :radius="8"
              fit="cover"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 模态框（使用 ScaleTransition） -->
    <a-modal
      v-model:open="showModal"
      :footer="null"
      :closable="false"
    >
      <ScaleTransition>
        <div v-if="showModal" class="modal-content">
          <!-- 模态框内容 -->
        </div>
      </ScaleTransition>
    </a-modal>

    <!-- 折叠面板（使用 CollapseTransition） -->
    <div class="collapsible-section">
      <div class="section-header" @click="toggleSection">
        <h3>高级设置</h3>
        <DownOutlined :class="{ rotated: sectionExpanded }" />
      </div>

      <CollapseTransition>
        <div v-if="sectionExpanded" class="section-content">
          <!-- 折叠内容 -->
        </div>
      </CollapseTransition>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'

// 导入优化工具
import { getRequestBatcher, batchedRequest } from '@/utils/request-batcher'
import { getOptimisticUpdateManager } from '@/utils/optimistic-update-manager'
import { getIncrementalSyncManager, trackChange } from '@/utils/incremental-sync'
import { getIntelligentPrefetchManager, enableHoverPrefetch } from '@/utils/intelligent-prefetch'
import { getAccessibilityManager, announce } from '@/utils/accessibility'
import keyboardShortcuts from '@/utils/keyboard-shortcuts'

// 路由
const route = useRoute()
const router = useRouter()
const projectId = route.params.id

// 状态
const fileTreeLoading = ref(true)
const editorLoading = ref(true)
const chatLoading = ref(true)
const showModal = ref(false)
const sectionExpanded = ref(false)

const currentProject = ref(null)
const currentFile = ref(null)
const fileTree = ref([])
const messages = ref([])

// 引用
const commandPalette = ref(null)

// 优化管理器实例
const requestBatcher = getRequestBatcher({
  batchWindow: 50,
  maxBatchSize: 10,
  enableCache: true,
})

const optimisticManager = getOptimisticUpdateManager({
  enableUndoRedo: true,
  enableOfflineQueue: true,
})

const syncManager = getIncrementalSyncManager({
  syncInterval: 30000,
  enableAutoSync: true,
})

const prefetchManager = getIntelligentPrefetchManager({
  enableHoverPrefetch: true,
  enableViewportPrefetch: true,
})

const a11yManager = getAccessibilityManager({
  enableAnnouncements: true,
  enableFocusTrap: true,
})

// 计算属性
const isDevelopment = computed(() => {
  return process.env.NODE_ENV === 'development'
})

/**
 * 加载项目数据（使用请求批处理）
 */
const loadProject = async () => {
  try {
    // 使用批处理加载多个资源
    const [projectData, files, chatMessages] = await Promise.all([
      batchedRequest('/api/projects/:id', { id: projectId }),
      batchedRequest('/api/projects/:id/files', { id: projectId }),
      batchedRequest('/api/projects/:id/messages', { id: projectId }),
    ])

    currentProject.value = projectData
    fileTree.value = files
    messages.value = chatMessages

    // 屏幕阅读器通知
    announce(`项目 ${projectData.name} 已加载`, 'polite')
  } catch (error) {
    console.error('[ProjectDetailPage] Load error:', error)
    message.error('加载项目失败')
  } finally {
    fileTreeLoading.value = false
    editorLoading.value = false
    chatLoading.value = false
  }
}

/**
 * 处理文件选择（使用乐观更新）
 */
const handleFileSelect = async (file) => {
  // 乐观更新：立即更新 UI
  const previousFile = currentFile.value

  await optimisticManager.update({
    entity: `file:${file.id}`,

    // 立即更新本地状态
    mutation: async () => {
      currentFile.value = file
      editorLoading.value = true
    },

    // 后台加载文件内容
    apiCall: async () => {
      const content = await batchedRequest('/api/files/:id/content', {
        id: file.id,
      })
      currentFile.value = { ...file, content }
      editorLoading.value = false
      return content
    },

    // 失败时回滚
    rollback: async () => {
      currentFile.value = previousFile
      editorLoading.value = false
    },

    onSuccess: () => {
      announce(`已打开文件 ${file.name}`, 'polite')

      // 跟踪变更（增量同步）
      trackChange(`file:${file.id}`, 'update', {
        lastOpened: Date.now(),
      })
    },

    onFailure: (error) => {
      message.error('打开文件失败')
    },
  })
}

/**
 * 保存文件（使用乐观更新 + 增量同步）
 */
const handleSaveFile = async () => {
  if (!currentFile.value) return

  await optimisticManager.update({
    entity: `file:${currentFile.value.id}`,

    mutation: async () => {
      // 立即显示保存成功状态
      message.loading('正在保存...', 0.5)
    },

    apiCall: async () => {
      // 跟踪变更
      trackChange(`file:${currentFile.value.id}`, 'update', {
        content: currentFile.value.content,
        updatedAt: Date.now(),
      })

      // 触发增量同步
      await syncManager.syncNow()

      return { success: true }
    },

    onSuccess: () => {
      message.success('保存成功')
      announce('文件已保存', 'polite')
    },

    onFailure: (error) => {
      message.error('保存失败，请重试')
    },
  })
}

/**
 * 注册键盘快捷键
 */
const registerShortcuts = () => {
  // 保存文件 (Ctrl+S)
  window.addEventListener('shortcut-save', handleSaveFile)

  // 查找 (Ctrl+F)
  window.addEventListener('shortcut-find', handleFind)

  // 撤销 (Ctrl+Z)
  window.addEventListener('shortcut-undo', async () => {
    await optimisticManager.undo()
    message.info('已撤销')
  })

  // 重做 (Ctrl+Shift+Z)
  window.addEventListener('shortcut-redo', async () => {
    await optimisticManager.redo()
    message.info('已重做')
  })

  // 切换侧边栏 (Ctrl+B)
  window.addEventListener('shortcut-toggle-sidebar', toggleSidebar)

  // 命令面板 (Ctrl+P) - 已在 keyboard-shortcuts.js 中注册

  // 设置作用域
  keyboardShortcuts.setScope('project-detail')
}

/**
 * 清理快捷键
 */
const cleanupShortcuts = () => {
  window.removeEventListener('shortcut-save', handleSaveFile)
  window.removeEventListener('shortcut-find', handleFind)

  keyboardShortcuts.setScope('global')
}

/**
 * 启用悬停预取
 */
const setupPrefetching = () => {
  // 为文件链接启用悬停预取
  document.querySelectorAll('.file-link').forEach((link) => {
    const fileId = link.dataset.fileId

    enableHoverPrefetch(
      link,
      `/api/files/${fileId}/content`,
      { type: 'fetch', priority: 'normal' }
    )
  })
}

/**
 * 切换折叠面板
 */
const toggleSection = () => {
  sectionExpanded.value = !sectionExpanded.value
}

/**
 * 切换侧边栏
 */
const toggleSidebar = () => {
  // 实现侧边栏切换逻辑
  console.log('Toggle sidebar')
}

/**
 * 查找
 */
const handleFind = () => {
  // 实现查找逻辑
  console.log('Find')
}

/**
 * 编辑器加载完成
 */
const handleEditorLoaded = () => {
  console.log('[ProjectDetailPage] Editor loaded')
}

/**
 * 发送消息
 */
const handleSendMessage = async (content) => {
  const newMessage = {
    id: Date.now(),
    content,
    timestamp: Date.now(),
    role: 'user',
  }

  // 乐观更新：立即添加到消息列表
  await optimisticManager.update({
    entity: `message:${newMessage.id}`,

    mutation: async () => {
      messages.value.push(newMessage)
    },

    apiCall: async () => {
      const response = await batchedRequest('/api/chat/send', {
        projectId,
        message: content,
      })
      return response
    },

    rollback: async () => {
      // 移除失败的消息
      const index = messages.value.findIndex((m) => m.id === newMessage.id)
      if (index > -1) {
        messages.value.splice(index, 1)
      }
    },

    onSuccess: (response) => {
      // 添加 AI 回复
      if (response.reply) {
        messages.value.push({
          id: Date.now() + 1,
          content: response.reply,
          timestamp: Date.now(),
          role: 'assistant',
        })
      }
    },

    onFailure: () => {
      message.error('发送消息失败')
    },
  })
}

/**
 * 返回项目列表
 */
const handleBackToList = () => {
  router.push('/projects')
}

// 生命周期
onMounted(() => {
  loadProject()
  registerShortcuts()
  setupPrefetching()

  // 监听同步事件
  window.addEventListener('incremental-sync-complete', () => {
    console.log('[ProjectDetailPage] Sync completed')
  })
})

onUnmounted(() => {
  cleanupShortcuts()
})
</script>

<style scoped>
.project-detail-page-optimized {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100vh;
  /* 使用 CSS Containment */
  contain: layout style;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #ffffff;
  /* Containment */
  contain: layout style paint;
}

.main-content {
  display: grid;
  grid-template-columns: 250px 1fr 350px;
  gap: 0;
  overflow: hidden;
}

.file-tree-panel,
.editor-panel,
.chat-panel {
  /* 独立的包含上下文 */
  contain: layout style paint;
  overflow: hidden;
}

/* 使用 transform 做动画 */
.file-tree-panel {
  transform: translateX(0);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.file-tree-panel.collapsed {
  transform: translateX(-100%);
}

/* 折叠面板 */
.collapsible-section {
  border-top: 1px solid #f0f0f0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  user-select: none;
}

.section-header:hover {
  background: #f5f5f5;
}

.section-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.section-header .rotated {
  transform: rotate(180deg);
  transition: transform 0.3s;
}

.section-content {
  padding: 16px;
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Dark theme */
.dark .toolbar {
  background: #1f1f1f;
  border-bottom-color: #3e3e3e;
}

.dark .collapsible-section {
  border-top-color: #3e3e3e;
}

.dark .section-header:hover {
  background: #2a2a2a;
}
</style>
```

---

## 4. API 层集成（services/api.js）

```javascript
// desktop-app-vue/src/renderer/services/api.js

import { getRequestBatcher } from '@/utils/request-batcher'
import { compress, decompress } from '@/utils/data-compression'

const batcher = getRequestBatcher()

/**
 * 统一 API 调用方法（自动批处理和压缩）
 */
export async function apiRequest(endpoint, params = {}, options = {}) {
  const {
    method = 'GET',
    enableBatching = true,
    enableCompression = true,
    ...otherOptions
  } = options

  // 使用批处理
  if (enableBatching && method === 'GET') {
    return batcher.request(endpoint, params, otherOptions)
  }

  // 常规请求（POST/PUT/DELETE）
  let body = params

  // 压缩大数据
  if (enableCompression && JSON.stringify(params).length > 10 * 1024) {
    body = await compress(JSON.stringify(params), { base64: true })
    otherOptions.headers = {
      ...otherOptions.headers,
      'Content-Encoding': 'gzip',
    }
  }

  const response = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...otherOptions.headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  // 解压响应（如果需要）
  const contentEncoding = response.headers.get('Content-Encoding')

  if (contentEncoding === 'gzip') {
    const compressedData = await response.text()
    const decompressedData = await decompress(compressedData, { fromBase64: true })
    return JSON.parse(decompressedData)
  }

  return response.json()
}

// 导出便捷方法
export const api = {
  get: (url, params, options) => apiRequest(url, params, { method: 'GET', ...options }),
  post: (url, data, options) => apiRequest(url, data, { method: 'POST', ...options }),
  put: (url, data, options) => apiRequest(url, data, { method: 'PUT', ...options }),
  delete: (url, params, options) => apiRequest(url, params, { method: 'DELETE', ...options }),
}
```

---

## 5. 性能优化检查清单

### ✅ 加载优化
- [x] 使用骨架屏替代 loading 动画
- [x] 并行加载独立数据（Promise.all）
- [x] 实现数据懒加载
- [x] 启用请求批处理

### ✅ 渲染优化
- [x] 使用虚拟滚动处理长列表
- [x] 使用 CSS Containment
- [x] 使用 transform 做动画
- [x] 减少 DOM 节点数量

### ✅ 交互优化
- [x] 实现键盘快捷键
- [x] 使用防抖和节流
- [x] 乐观更新 UI
- [x] 提供即时反馈

### ✅ 代码优化
- [x] 组件懒加载
- [x] 代码分割
- [x] 数据压缩
- [x] 请求批处理

### ✅ 无障碍性
- [x] ARIA 属性
- [x] 键盘导航
- [x] 屏幕阅读器支持
- [x] Reduced Motion 支持

---

## 6. 性能监控

在开发环境中启用性能监控面板：

```vue
<template>
  <div>
    <!-- 应用内容 -->

    <!-- 性能监控面板（仅开发环境） -->
    <PerformanceMonitor v-if="isDevelopment" />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const isDevelopment = computed(() => {
  return process.env.NODE_ENV === 'development'
})
</script>
```

---

## 7. 测试

### 性能测试

```javascript
// tests/performance/optimizations.test.js

import { describe, it, expect } from 'vitest'
import { getLazyLoader } from '@/utils/image-lazy-loader'
import { getRequestBatcher } from '@/utils/request-batcher'

describe('Image Lazy Loading', () => {
  it('should reduce bandwidth', async () => {
    const lazyLoader = getLazyLoader()
    const stats = lazyLoader.getStats()

    expect(stats.bandwidthSavedKB).toBeGreaterThan(0)
  })
})

describe('Request Batching', () => {
  it('should batch requests', async () => {
    const batcher = getRequestBatcher()

    // Simulate multiple requests
    const requests = await Promise.all([
      batcher.request('/api/data', { id: 1 }),
      batcher.request('/api/data', { id: 2 }),
      batcher.request('/api/data', { id: 3 }),
    ])

    const stats = batcher.getStats()

    expect(stats.batchedRequests).toBeGreaterThan(0)
  })
})
```

---

## 8. 故障排查

### 常见问题

**Q: 骨架屏一直显示，不消失？**
A: 检查 loading 状态是否正确更新，确保 API 调用成功后设置 `loading.value = false`

**Q: 键盘快捷键不生效？**
A: 检查作用域设置，确保 `keyboardShortcuts.setScope()` 正确调用

**Q: 图片懒加载不工作？**
A: 检查是否设置了 `data-src` 属性，并且 IntersectionObserver API 可用

**Q: 请求批处理没有效果？**
A: 检查批处理窗口（batchWindow）设置，确保请求在窗口期内发送

**Q: 乐观更新回滚失败？**
A: 检查 rollback 函数是否正确实现，确保能够恢复到之前的状态

---

## 9. 下一步

- [ ] 进行性能基准测试
- [ ] 收集用户反馈
- [ ] 调整优化参数
- [ ] 监控生产环境性能
- [ ] 持续优化和改进

---

## 10. 参考资源

- [骨架屏使用指南](./OPTIMIZATION_USAGE_GUIDE.md#1-骨架屏加载)
- [键盘快捷键系统](./OPTIMIZATION_USAGE_GUIDE.md#2-键盘快捷键系统)
- [图片懒加载](./OPTIMIZATION_USAGE_GUIDE.md#4-图片懒加载)
- [请求批处理](./OPTIMIZATION_USAGE_GUIDE.md#5-请求批处理与去重)
- [组件懒加载](./OPTIMIZATION_USAGE_GUIDE.md#6-组件懒加载)
- [乐观更新](./OPTIMIZATION_USAGE_GUIDE.md#7-乐观更新)
- [性能优化最佳实践](./PROJECT_DETAIL_ADVANCED_OPTIMIZATIONS.md)
