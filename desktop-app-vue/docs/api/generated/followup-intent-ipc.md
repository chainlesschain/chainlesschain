# followup-intent-ipc

**Source**: `src/main/ai-engine/followup-intent-ipc.js`

**Generated**: 2026-02-22T01:23:36.764Z

---

## const

```javascript
const
```

* 后续输入意图分类器 - IPC Handler
 * 提供给渲染进程调用的 IPC 接口

---

## function initializeClassifier(llmService)

```javascript
function initializeClassifier(llmService)
```

* 初始化分类器

---

## function registerIPCHandlers(llmService)

```javascript
function registerIPCHandlers(llmService)
```

* 注册 IPC 处理器

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 分类单个输入
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Promise<Object>} 分类结果

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量分类

---

## ipcMain.handle("followup-intent:get-stats", async () =>

```javascript
ipcMain.handle("followup-intent:get-stats", async () =>
```

* 获取分类器统计信息

---

## function getClassifierInstance()

```javascript
function getClassifierInstance()
```

* 获取分类器实例（用于测试）

---

