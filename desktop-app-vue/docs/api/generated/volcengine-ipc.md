# volcengine-ipc

**Source**: `src/main/llm/volcengine-ipc.js`

**Generated**: 2026-02-21T20:04:16.238Z

---

## const

```javascript
const
```

* 火山引擎工具调用 IPC 处理器
 *
 * 提供渲染进程与主进程之间的通信桥梁

---

## function getToolsClient()

```javascript
function getToolsClient()
```

* 获取或创建工具客户端

---

## function registerVolcengineIPC()

```javascript
function registerVolcengineIPC()
```

* 注册所有 IPC 处理器

---

## ipcMain.handle("volcengine:select-model", async (event,

```javascript
ipcMain.handle("volcengine:select-model", async (event,
```

* 智能选择模型（根据场景）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 根据任务类型选择模型

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 估算成本

---

## ipcMain.handle("volcengine:list-models", async (event,

```javascript
ipcMain.handle("volcengine:list-models", async (event,
```

* 列出所有模型

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 联网搜索对话

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 图像处理对话

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 图像理解（简化接口）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 配置知识库（上传文档）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 知识库搜索对话

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Function Calling 对话

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 执行完整的 Function Calling 流程
   * 注意：functionExecutor 需要在主进程侧定义

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* MCP 对话

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 多工具混合对话

---

## ipcMain.handle("volcengine:check-config", async (event) =>

```javascript
ipcMain.handle("volcengine:check-config", async (event) =>
```

* 检查配置状态

---

## ipcMain.handle("volcengine:update-config", async (event,

```javascript
ipcMain.handle("volcengine:update-config", async (event,
```

* 更新配置

---

## function getFunctionExecutor(executorType)

```javascript
function getFunctionExecutor(executorType)
```

* 获取函数执行器
 * @param {string} executorType - 执行器类型
 * @returns {Object} 函数执行器

---

## function unregisterVolcengineIPC()

```javascript
function unregisterVolcengineIPC()
```

* 注销所有 IPC 处理器

---

