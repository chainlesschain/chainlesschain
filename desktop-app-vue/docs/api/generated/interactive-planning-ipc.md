# interactive-planning-ipc

**Source**: `src\main\ai-engine\interactive-planning-ipc.js`

**Generated**: 2026-01-27T06:44:03.878Z

---

## let electronModule = null;

```javascript
let electronModule = null;
```

* 交互式任务规划 IPC 接口
 * 供前端调用交互式任务规划器

---

## constructor(interactiveTaskPlanner, options =

```javascript
constructor(interactiveTaskPlanner, options =
```

* @param {Object} interactiveTaskPlanner - 交互式任务规划器实例
   * @param {Object} options - 可选配置，用于测试时注入依赖
   * @param {Object} options.ipcMain - IPC 主进程模块（用于测试注入）
   * @param {Object} options.BrowserWindow - BrowserWindow 模块（用于测试注入）

---

## this.ipcMain.handle('interactive-planning:start-session', async (event,

```javascript
this.ipcMain.handle('interactive-planning:start-session', async (event,
```

* 开始Plan模式对话

---

## this.ipcMain.handle('interactive-planning:respond', async (event,

```javascript
this.ipcMain.handle('interactive-planning:respond', async (event,
```

* 用户确认或调整Plan

---

## this.ipcMain.handle('interactive-planning:submit-feedback', async (event,

```javascript
this.ipcMain.handle('interactive-planning:submit-feedback', async (event,
```

* 提交用户反馈

---

## this.ipcMain.handle('interactive-planning:get-session', async (event,

```javascript
this.ipcMain.handle('interactive-planning:get-session', async (event,
```

* 获取会话信息

---

## this.ipcMain.handle('interactive-planning:cleanup', async (event,

```javascript
this.ipcMain.handle('interactive-planning:cleanup', async (event,
```

* 清理过期会话

---

## setupEventForwarding()

```javascript
setupEventForwarding()
```

* 设置事件转发到渲染进程

---

## broadcastToAll(channel, data)

```javascript
broadcastToAll(channel, data)
```

* 广播事件到所有窗口

---

