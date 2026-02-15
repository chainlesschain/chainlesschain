# manus-ipc

**Source**: `src/main/llm/manus-ipc.js`

**Generated**: 2026-02-15T07:37:13.823Z

---

## const

```javascript
const
```

* Manus 优化 IPC 处理器
 *
 * 提供前端访问 Context Engineering 和 Tool Masking 功能的接口

---

## function registerManusIPC()

```javascript
function registerManusIPC()
```

* 注册 Manus 优化相关的 IPC 处理器

---

## ipcMain.handle("manus:start-task", async (event, task) =>

```javascript
ipcMain.handle("manus:start-task", async (event, task) =>
```

* 开始任务追踪
   * @param {Object} task - 任务信息
   * @param {string} task.objective - 任务目标
   * @param {Array} task.steps - 任务步骤

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新任务进度
   * @param {number} stepIndex - 当前步骤索引
   * @param {string} status - 状态

---

## ipcMain.handle("manus:complete-step", async (event) =>

```javascript
ipcMain.handle("manus:complete-step", async (event) =>
```

* 完成当前步骤

---

## ipcMain.handle("manus:complete-task", async (event) =>

```javascript
ipcMain.handle("manus:complete-task", async (event) =>
```

* 完成任务

---

## ipcMain.handle("manus:cancel-task", async (event) =>

```javascript
ipcMain.handle("manus:cancel-task", async (event) =>
```

* 取消任务

---

## ipcMain.handle("manus:get-current-task", async (event) =>

```javascript
ipcMain.handle("manus:get-current-task", async (event) =>
```

* 获取当前任务

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 设置工具可用性
   * @param {string} toolName - 工具名称
   * @param {boolean} available - 是否可用

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 按前缀设置工具可用性
   * @param {string} prefix - 工具前缀
   * @param {boolean} available - 是否可用

---

## ipcMain.handle("manus:validate-tool-call", async (event,

```javascript
ipcMain.handle("manus:validate-tool-call", async (event,
```

* 验证工具调用
   * @param {string} toolName - 工具名称

---

## ipcMain.handle("manus:get-available-tools", async (event) =>

```javascript
ipcMain.handle("manus:get-available-tools", async (event) =>
```

* 获取可用工具列表

---

## ipcMain.handle("manus:configure-phases", async (event, config) =>

```javascript
ipcMain.handle("manus:configure-phases", async (event, config) =>
```

* 配置任务阶段状态机
   * @param {Object} config - 状态机配置（可选）

---

## ipcMain.handle("manus:transition-to-phase", async (event,

```javascript
ipcMain.handle("manus:transition-to-phase", async (event,
```

* 切换到指定阶段
   * @param {string} phase - 阶段名称

---

## ipcMain.handle("manus:get-current-phase", async (event) =>

```javascript
ipcMain.handle("manus:get-current-phase", async (event) =>
```

* 获取当前阶段

---

## ipcMain.handle("manus:record-error", async (event, error) =>

```javascript
ipcMain.handle("manus:record-error", async (event, error) =>
```

* 记录错误
   * @param {Object} error - 错误信息

---

## ipcMain.handle("manus:resolve-error", async (event,

```javascript
ipcMain.handle("manus:resolve-error", async (event,
```

* 标记错误已解决
   * @param {string} resolution - 解决方案

---

## ipcMain.handle("manus:get-stats", async (event) =>

```javascript
ipcMain.handle("manus:get-stats", async (event) =>
```

* 获取 Manus 优化统计

---

## ipcMain.handle("manus:reset-stats", async (event) =>

```javascript
ipcMain.handle("manus:reset-stats", async (event) =>
```

* 重置统计

---

## ipcMain.handle("manus:export-debug-info", async (event) =>

```javascript
ipcMain.handle("manus:export-debug-info", async (event) =>
```

* 导出调试信息

---

## ipcMain.handle("manus:build-optimized-prompt", async (event, options) =>

```javascript
ipcMain.handle("manus:build-optimized-prompt", async (event, options) =>
```

* 构建优化后的 Prompt
   * @param {Object} options - 构建选项

---

## ipcMain.handle("manus:compress-content", async (event,

```javascript
ipcMain.handle("manus:compress-content", async (event,
```

* 压缩内容
   * @param {any} content - 原始内容
   * @param {string} type - 内容类型

---

