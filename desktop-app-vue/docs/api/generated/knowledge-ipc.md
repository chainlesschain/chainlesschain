# knowledge-ipc

**Source**: `src/main/knowledge/knowledge-ipc.js`

**Generated**: 2026-02-15T10:10:53.415Z

---

## function registerKnowledgeIPC(

```javascript
function registerKnowledgeIPC(
```

* 知识管理 IPC
 * 处理知识库标签、版本管理、付费内容等操作
 *
 * @module knowledge-ipc
 * @description 知识管理模块，提供标签管理、版本控制、付费内容管理等功能

---

## function registerKnowledgeIPC(

```javascript
function registerKnowledgeIPC(
```

* 注册知识管理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.dbManager - 数据库管理器实例
 * @param {Object} dependencies.versionManager - 版本管理器实例
 * @param {Object} dependencies.knowledgePaymentManager - 知识付费管理器实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）

---

## ipcMain.handle("knowledge:get-tags", async (_event) =>

```javascript
ipcMain.handle("knowledge:get-tags", async (_event) =>
```

* 获取标签列表

---

## ipcMain.handle("knowledge:get-version-history", async (_event, params) =>

```javascript
ipcMain.handle("knowledge:get-version-history", async (_event, params) =>
```

* 获取版本历史

---

## ipcMain.handle("knowledge:restore-version", async (_event, params) =>

```javascript
ipcMain.handle("knowledge:restore-version", async (_event, params) =>
```

* 恢复版本

---

## ipcMain.handle("knowledge:compare-versions", async (_event, params) =>

```javascript
ipcMain.handle("knowledge:compare-versions", async (_event, params) =>
```

* 对比版本

---

## ipcMain.handle("knowledge:create-content", async (_event, options) =>

```javascript
ipcMain.handle("knowledge:create-content", async (_event, options) =>
```

* 创建付费内容

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新内容

---

## ipcMain.handle("knowledge:delete-content", async (_event, contentId) =>

```javascript
ipcMain.handle("knowledge:delete-content", async (_event, contentId) =>
```

* 删除内容

---

## ipcMain.handle("knowledge:get-content", async (_event, contentId) =>

```javascript
ipcMain.handle("knowledge:get-content", async (_event, contentId) =>
```

* 获取内容

---

## ipcMain.handle("knowledge:list-contents", async (_event, filters) =>

```javascript
ipcMain.handle("knowledge:list-contents", async (_event, filters) =>
```

* 列出内容

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 购买内容

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 订阅

---

## ipcMain.handle("knowledge:unsubscribe", async (_event, planId) =>

```javascript
ipcMain.handle("knowledge:unsubscribe", async (_event, planId) =>
```

* 取消订阅

---

## ipcMain.handle("knowledge:get-my-purchases", async (_event, userDid) =>

```javascript
ipcMain.handle("knowledge:get-my-purchases", async (_event, userDid) =>
```

* 获取我的购买记录

---

## ipcMain.handle("knowledge:get-my-subscriptions", async (_event, userDid) =>

```javascript
ipcMain.handle("knowledge:get-my-subscriptions", async (_event, userDid) =>
```

* 获取我的订阅记录

---

## ipcMain.handle("knowledge:access-content", async (_event, contentId) =>

```javascript
ipcMain.handle("knowledge:access-content", async (_event, contentId) =>
```

* 访问内容

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 检查访问权限

---

## ipcMain.handle("knowledge:get-statistics", async (_event, creatorDid) =>

```javascript
ipcMain.handle("knowledge:get-statistics", async (_event, creatorDid) =>
```

* 获取统计信息

---

