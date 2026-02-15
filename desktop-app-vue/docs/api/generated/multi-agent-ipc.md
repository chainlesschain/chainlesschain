# multi-agent-ipc

**Source**: `src/main/ai-engine/multi-agent/multi-agent-ipc.js`

**Generated**: 2026-02-15T07:37:13.873Z

---

## const

```javascript
const
```

* 多 Agent 系统 IPC 处理器
 *
 * 提供前端访问多 Agent 系统的接口

---

## function registerMultiAgentIPC(options =

```javascript
function registerMultiAgentIPC(options =
```

* 注册多 Agent 系统 IPC 处理器
 * @param {Object} options - 配置选项

---

## ipcMain.handle("agent:list", async (event) =>

```javascript
ipcMain.handle("agent:list", async (event) =>
```

* 获取所有注册的 Agent

---

## ipcMain.handle("agent:get", async (event,

```javascript
ipcMain.handle("agent:get", async (event,
```

* 获取特定 Agent 信息

---

## ipcMain.handle("agent:dispatch", async (event, task) =>

```javascript
ipcMain.handle("agent:dispatch", async (event, task) =>
```

* 分发任务到合适的 Agent

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 并行执行多个任务

---

## ipcMain.handle("agent:execute-chain", async (event,

```javascript
ipcMain.handle("agent:execute-chain", async (event,
```

* 链式执行任务

---

## ipcMain.handle("agent:get-capable", async (event, task) =>

```javascript
ipcMain.handle("agent:get-capable", async (event, task) =>
```

* 获取能处理特定任务的 Agent

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 发送消息给特定 Agent

---

## ipcMain.handle("agent:broadcast", async (event,

```javascript
ipcMain.handle("agent:broadcast", async (event,
```

* 广播消息给所有 Agent

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取消息历史

---

## ipcMain.handle("agent:get-stats", async (event) =>

```javascript
ipcMain.handle("agent:get-stats", async (event) =>
```

* 获取统计信息

---

## ipcMain.handle("agent:get-history", async (event,

```javascript
ipcMain.handle("agent:get-history", async (event,
```

* 获取执行历史

---

## ipcMain.handle("agent:reset-stats", async (event) =>

```javascript
ipcMain.handle("agent:reset-stats", async (event) =>
```

* 重置统计

---

## ipcMain.handle("agent:export-debug", async (event) =>

```javascript
ipcMain.handle("agent:export-debug", async (event) =>
```

* 导出调试信息

---

