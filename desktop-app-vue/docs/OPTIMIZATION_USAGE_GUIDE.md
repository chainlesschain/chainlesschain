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

## 5. 在 ProjectDetailPage 中集成

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
