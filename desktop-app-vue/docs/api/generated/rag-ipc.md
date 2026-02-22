# rag-ipc

**Source**: `src/main/rag/rag-ipc.js`

**Generated**: 2026-02-22T01:23:36.688Z

---

## function registerRAGIPC(

```javascript
function registerRAGIPC(
```

* RAG（检索增强生成）IPC 处理器
 * 负责处理 RAG 知识库检索相关的前后端通信
 *
 * @module rag-ipc
 * @description 提供 RAG 知识库检索、增强查询、索引管理、配置等 IPC 接口

---

## function registerRAGIPC(

```javascript
function registerRAGIPC(
```

* 注册所有 RAG IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.ragManager - RAG 管理器
 * @param {Object} [dependencies.llmManager] - LLM 管理器（用于嵌入生成）
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.ipcGuard] - IPC Guard模块（可选，用于测试注入）

---

## ipcMain.handle("rag:retrieve", async (_event, query, options =

```javascript
ipcMain.handle("rag:retrieve", async (_event, query, options =
```

* 检索相关知识
   * Channel: 'rag:retrieve'

---

## ipcMain.handle("rag:enhance-query", async (_event, query, options =

```javascript
ipcMain.handle("rag:enhance-query", async (_event, query, options =
```

* 增强查询（检索 + 上下文增强）
   * Channel: 'rag:enhance-query'

---

## ipcMain.handle("rag:rebuild-index", async () =>

```javascript
ipcMain.handle("rag:rebuild-index", async () =>
```

* 重建索引
   * Channel: 'rag:rebuild-index'

---

## ipcMain.handle("rag:get-stats", async () =>

```javascript
ipcMain.handle("rag:get-stats", async () =>
```

* 获取索引统计信息
   * Channel: 'rag:get-stats'

---

## ipcMain.handle("rag:update-config", async (_event, config) =>

```javascript
ipcMain.handle("rag:update-config", async (_event, config) =>
```

* 更新 RAG 配置
   * Channel: 'rag:update-config'

---

## ipcMain.handle("rag:get-rerank-config", async () =>

```javascript
ipcMain.handle("rag:get-rerank-config", async () =>
```

* 获取重排序配置
   * Channel: 'rag:get-rerank-config'

---

## ipcMain.handle("rag:set-reranking-enabled", async (_event, enabled) =>

```javascript
ipcMain.handle("rag:set-reranking-enabled", async (_event, enabled) =>
```

* 设置重排序启用状态
   * Channel: 'rag:set-reranking-enabled'

---

