# sandbox-ipc

**Source**: `src/main/sandbox/sandbox-ipc.js`

**Generated**: 2026-02-15T08:42:37.193Z

---

## const

```javascript
const
```

* Sandbox IPC 处理器
 *
 * 负责处理代码执行沙箱相关的前后端通信
 *
 * @module sandbox-ipc
 * @version 1.0.0

---

## function registerSandboxIPC(

```javascript
function registerSandboxIPC(
```

* 注册 Sandbox IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.pythonSandbox - Python 沙箱实例
 * @param {Object} [dependencies.mainWindow] - 主窗口实例
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 守卫

---

## ipcMain.handle('sandbox:check-status', async () =>

```javascript
ipcMain.handle('sandbox:check-status', async () =>
```

* 检查沙箱状态
   * Channel: 'sandbox:check-status'

---

## ipcMain.handle('sandbox:initialize', async () =>

```javascript
ipcMain.handle('sandbox:initialize', async () =>
```

* 初始化沙箱
   * Channel: 'sandbox:initialize'

---

## ipcMain.handle('sandbox:execute-python', async (event, params) =>

```javascript
ipcMain.handle('sandbox:execute-python', async (event, params) =>
```

* 执行 Python 代码
   * Channel: 'sandbox:execute-python'
   * @param {Object} params - 执行参数
   * @param {string} params.code - Python 代码
   * @param {number} [params.timeout] - 超时时间 (ms)
   * @param {Object} [params.inputData] - 输入数据
   * @param {string} [params.memoryLimit] - 内存限制

---

## ipcMain.handle('sandbox:kill-execution', async (event, executionId) =>

```javascript
ipcMain.handle('sandbox:kill-execution', async (event, executionId) =>
```

* 终止执行
   * Channel: 'sandbox:kill-execution'

---

## ipcMain.handle('sandbox:get-stats', async () =>

```javascript
ipcMain.handle('sandbox:get-stats', async () =>
```

* 获取统计数据
   * Channel: 'sandbox:get-stats'

---

## ipcMain.handle('sandbox:update-config', async (event, config) =>

```javascript
ipcMain.handle('sandbox:update-config', async (event, config) =>
```

* 更新配置
   * Channel: 'sandbox:update-config'

---

## function checkCodeSecurity(code)

```javascript
function checkCodeSecurity(code)
```

* 代码安全检查
 * @param {string} code - Python 代码
 * @returns {Object} 检查结果

---

## function validateConfig(config)

```javascript
function validateConfig(config)
```

* 验证配置
 * @param {Object} config - 配置对象
 * @returns {Object} 验证后的配置

---

