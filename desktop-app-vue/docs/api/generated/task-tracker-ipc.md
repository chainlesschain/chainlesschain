# task-tracker-ipc

**Source**: `src/main/ai-engine/task-tracker-ipc.js`

**Generated**: 2026-02-21T22:04:25.867Z

---

## const

```javascript
const
```

* 任务追踪 IPC 处理器
 *
 * 提供前端访问 TaskTrackerFile (todo.md 机制) 的接口

---

## function registerTaskTrackerIPC()

```javascript
function registerTaskTrackerIPC()
```

* 注册任务追踪 IPC 处理器

---

## ipcMain.handle("task-tracker:create", async (event, plan) =>

```javascript
ipcMain.handle("task-tracker:create", async (event, plan) =>
```

* 创建任务

---

## ipcMain.handle("task-tracker:start", async (event) =>

```javascript
ipcMain.handle("task-tracker:start", async (event) =>
```

* 开始任务

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新任务进度

---

## ipcMain.handle("task-tracker:complete-step", async (event, result) =>

```javascript
ipcMain.handle("task-tracker:complete-step", async (event, result) =>
```

* 完成当前步骤

---

## ipcMain.handle("task-tracker:complete", async (event, result) =>

```javascript
ipcMain.handle("task-tracker:complete", async (event, result) =>
```

* 完成任务

---

## ipcMain.handle("task-tracker:cancel", async (event, reason) =>

```javascript
ipcMain.handle("task-tracker:cancel", async (event, reason) =>
```

* 取消任务

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 记录步骤错误

---

## ipcMain.handle("task-tracker:get-current", async (event) =>

```javascript
ipcMain.handle("task-tracker:get-current", async (event) =>
```

* 获取当前任务

---

## ipcMain.handle("task-tracker:has-active", async (event) =>

```javascript
ipcMain.handle("task-tracker:has-active", async (event) =>
```

* 检查是否有活动任务

---

## ipcMain.handle("task-tracker:get-todo-context", async (event) =>

```javascript
ipcMain.handle("task-tracker:get-todo-context", async (event) =>
```

* 获取 todo.md 内容

---

## ipcMain.handle("task-tracker:get-prompt-context", async (event) =>

```javascript
ipcMain.handle("task-tracker:get-prompt-context", async (event) =>
```

* 获取任务上下文（用于 prompt）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 保存中间结果

---

## ipcMain.handle("task-tracker:load-result", async (event,

```javascript
ipcMain.handle("task-tracker:load-result", async (event,
```

* 加载中间结果

---

## ipcMain.handle("task-tracker:load-unfinished", async (event) =>

```javascript
ipcMain.handle("task-tracker:load-unfinished", async (event) =>
```

* 加载未完成的任务

---

## ipcMain.handle("task-tracker:get-history", async (event,

```javascript
ipcMain.handle("task-tracker:get-history", async (event,
```

* 获取任务历史

---

