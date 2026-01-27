# 消息聚合器集成指南

## 概述

消息聚合器已在后端实施，用于批量推送IPC消息到前端，避免消息轰炸。

## 后端实现

**文件**: `src/main/utils/message-aggregator.js`

**已集成位置**:
- `src/main/project/project-ai-ipc.js` - 任务进度更新

## 前端集成方法

### 方法1: 监听批量消息（推荐）

```javascript
import { ipcRenderer } from 'electron'

// 监听批量任务进度更新
ipcRenderer.on('batch:task:progress-update', (event, progressList) => {
  console.log(`收到${progressList.length}条进度更新`)

  // 批量更新UI
  for (const progress of progressList) {
    updateTaskProgress(progress)
  }
})
```

### 方法2: 向后兼容（可选）

如果需要保持单条消息的兼容性，可以在前端模拟：

```javascript
ipcRenderer.on('batch:task:progress-update', (event, progressList) => {
  // 将批量消息拆分为单条
  for (const progress of progressList) {
    // 触发原有的单条消息处理逻辑
    handleSingleProgress(progress)
  }
})
```

## 性能提升

### 优化前
- 50个任务 = 150+ 条单独的IPC消息
- 前端需要150+ 次DOM更新
- 可能导致1-2秒卡顿

### 优化后
- 50个任务 = ~15 批消息（100ms间隔）
- 前端批量更新DOM
- 流畅无卡顿

## 需要集成的前端页面

1. **ProjectsPage.vue** - 项目列表页的任务进度
2. **ProjectDetailPage.vue** - 项目详情页的执行监控
3. **TaskExecutionMonitor.vue** - 任务执行监控组件

## 示例：在Vue组件中使用

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { ipcRenderer } from 'electron'

const tasks = ref(new Map())

// 批量更新任务进度
function handleBatchProgress(progressList) {
  for (const progress of progressList) {
    const { taskId, status, percentage } = progress

    if (tasks.value.has(taskId)) {
      const task = tasks.value.get(taskId)
      task.status = status
      task.percentage = percentage
    }
  }

  // Vue会自动批量更新DOM
}

onMounted(() => {
  ipcRenderer.on('batch:task:progress-update', (event, progressList) => {
    handleBatchProgress(progressList)
  })
})

onUnmounted(() => {
  ipcRenderer.removeAllListeners('batch:task:progress-update')
})
</script>
```

## 统计信息

可以通过IPC获取聚合器统计：

```javascript
// 后端添加handler
ipcMain.handle('message-aggregator:stats', () => {
  const aggregator = getMessageAggregator()
  return aggregator.getStats()
})

// 前端调用
const stats = await ipcRenderer.invoke('message-aggregator:stats')
console.log('聚合器统计:', stats)
// {
//   totalMessages: 1500,
//   totalBatches: 150,
//   avgBatchSize: 10,
//   queueSize: 5,
//   isActive: true
// }
```

## 配置选项

可以在创建时自定义配置：

```javascript
const aggregator = new MessageAggregator({
  window: mainWindow,
  batchInterval: 100,    // 批量间隔（ms），默认100
  maxBatchSize: 100      // 单批最大消息数，默认100
})
```

## 注意事项

1. **不要过度依赖实时性**: 消息会延迟最多100ms，如果需要立即响应，使用`flushNow()`
2. **清理监听器**: 组件卸载时记得移除监听器，避免内存泄漏
3. **错误处理**: 批量消息中可能包含多种状态，注意错误处理

## 待办事项

- [ ] 在ProjectsPage.vue中集成批量消息监听
- [ ] 在ProjectDetailPage.vue中集成
- [ ] 在TaskExecutionMonitor.vue中集成
- [ ] 添加性能监控面板显示聚合器统计
- [ ] 测试大量任务时的性能提升
