# error-monitor-ipc

**Source**: `src/main/monitoring/error-monitor-ipc.js`

**Generated**: 2026-02-15T08:42:37.219Z

---

## const

```javascript
const
```

* ErrorMonitor IPC 处理器
 * 负责处理错误监控和 AI 诊断相关的前后端通信
 *
 * @module error-monitor-ipc
 * @version 1.0.0
 * @since 2026-01-16

---

## function registerErrorMonitorIPC(

```javascript
function registerErrorMonitorIPC(
```

* 注册所有 ErrorMonitor IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.errorMonitor - ErrorMonitor 实例
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象（可选，用于测试注入）

---

## ipcMain.handle("error:analyze", async (_event, error) =>

```javascript
ipcMain.handle("error:analyze", async (_event, error) =>
```

* 分析错误并提供 AI 诊断
   * Channel: 'error:analyze'

---

## ipcMain.handle("error:get-diagnosis-report", async (_event, analysisId) =>

```javascript
ipcMain.handle("error:get-diagnosis-report", async (_event, analysisId) =>
```

* 生成错误诊断报告（Markdown 格式）
   * Channel: 'error:get-diagnosis-report'

---

## ipcMain.handle("error:get-stats", async (_event, options =

```javascript
ipcMain.handle("error:get-stats", async (_event, options =
```

* 获取错误统计信息
   * Channel: 'error:get-stats'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 查找相关错误
   * Channel: 'error:get-related-issues'

---

## ipcMain.handle("error:get-analysis-history", async (_event, options =

```javascript
ipcMain.handle("error:get-analysis-history", async (_event, options =
```

* 获取错误分析历史
   * Channel: 'error:get-analysis-history'

---

## ipcMain.handle("error:delete-analysis", async (_event, analysisId) =>

```javascript
ipcMain.handle("error:delete-analysis", async (_event, analysisId) =>
```

* 删除错误分析记录
   * Channel: 'error:delete-analysis'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 清理旧的错误分析记录
   * Channel: 'error:cleanup-old-analyses'

---

## ipcMain.handle("error:get-classification-stats", async (_event, days = 7) =>

```javascript
ipcMain.handle("error:get-classification-stats", async (_event, days = 7) =>
```

* 获取错误分类统计
   * Channel: 'error:get-classification-stats'

---

## ipcMain.handle("error:get-severity-stats", async (_event, days = 7) =>

```javascript
ipcMain.handle("error:get-severity-stats", async (_event, days = 7) =>
```

* 获取错误严重程度统计
   * Channel: 'error:get-severity-stats'

---

## ipcMain.handle("error:toggle-ai-diagnosis", async (_event, enabled) =>

```javascript
ipcMain.handle("error:toggle-ai-diagnosis", async (_event, enabled) =>
```

* 启用/禁用 AI 诊断
   * Channel: 'error:toggle-ai-diagnosis'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新分析状态
   * Channel: 'error:update-status'

---

## ipcMain.handle("error:get-config", async () =>

```javascript
ipcMain.handle("error:get-config", async () =>
```

* 获取诊断配置
   * Channel: 'error:get-config'

---

## ipcMain.handle("error:update-config", async (_event, updates) =>

```javascript
ipcMain.handle("error:update-config", async (_event, updates) =>
```

* 更新诊断配置
   * Channel: 'error:update-config'

---

## ipcMain.handle("error:get-daily-trend", async (_event, days = 7) =>

```javascript
ipcMain.handle("error:get-daily-trend", async (_event, days = 7) =>
```

* 获取每日错误趋势
   * Channel: 'error:get-daily-trend'

---

## ipcMain.handle("error:reanalyze", async (_event, errorId) =>

```javascript
ipcMain.handle("error:reanalyze", async (_event, errorId) =>
```

* 重新分析错误（使用 AI）
   * Channel: 'error:reanalyze'

---

## ipcMain.handle("log:error", async (_event, errorInfo) =>

```javascript
ipcMain.handle("log:error", async (_event, errorInfo) =>
```

* 记录渲染进程的错误到日志文件
   * Channel: 'log:error'

---

## function updateErrorMonitor(newErrorMonitor)

```javascript
function updateErrorMonitor(newErrorMonitor)
```

* 更新 ErrorMonitor 引用
   * 用于热重载或重新初始化
   * @param {ErrorMonitor} newErrorMonitor - 新的 ErrorMonitor 实例

---

