# interactive-planning-ipc

**Source**: `src/main/ai-engine/interactive-planning-ipc.js`

**Generated**: 2026-02-15T08:42:37.271Z

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

## this.ipcMain.handle(

```javascript
this.ipcMain.handle(
```

* 开始Plan模式对话

---

## this.ipcMain.handle(

```javascript
this.ipcMain.handle(
```

* 用户确认或调整Plan

---

## this.ipcMain.handle(

```javascript
this.ipcMain.handle(
```

* 提交用户反馈

---

## this.ipcMain.handle(

```javascript
this.ipcMain.handle(
```

* 获取会话信息

---

## this.ipcMain.handle(

```javascript
this.ipcMain.handle(
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

