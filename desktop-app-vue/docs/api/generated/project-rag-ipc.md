# project-rag-ipc

**Source**: `src/main/project/project-rag-ipc.js`

**Generated**: 2026-02-15T07:37:13.798Z

---

## const

```javascript
const
```

* 项目 RAG 检索 IPC
 * 处理项目文件的向量索引和增强检索
 *
 * @module project-rag-ipc
 * @description 项目 RAG 模块，支持文件索引、增强查询、统计等功能

---

## function registerProjectRAGIPC(

```javascript
function registerProjectRAGIPC(
```

* 注册项目 RAG 检索相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.getProjectRAGManager - 获取项目 RAG 管理器
 * @param {Function} dependencies.getProjectConfig - 获取项目配置
 * @param {Object} dependencies.RAGAPI - RAG API 实例

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 索引项目文件
   * 将项目中的所有文件建立向量索引

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* RAG 增强查询（旧版）
   * 使用向量检索增强的查询功能

---

## ipcMain.handle("project:updateFileIndex", async (_event, fileId) =>

```javascript
ipcMain.handle("project:updateFileIndex", async (_event, fileId) =>
```

* 更新单个文件索引
   * 当文件内容变化时更新其向量索引

---

## ipcMain.handle("project:deleteIndex", async (_event, projectId) =>

```javascript
ipcMain.handle("project:deleteIndex", async (_event, projectId) =>
```

* 删除项目索引
   * 删除项目的所有向量索引数据

---

## ipcMain.handle("project:getIndexStats", async (_event, projectId) =>

```javascript
ipcMain.handle("project:getIndexStats", async (_event, projectId) =>
```

* 获取项目索引统计
   * 获取项目索引的文档数量、向量维度等统计信息

---

## ipcMain.handle("project:rag-index", async (_event, projectId, repoPath) =>

```javascript
ipcMain.handle("project:rag-index", async (_event, projectId, repoPath) =>
```

* 索引项目（新版）
   * 使用 RAGAPI 建立项目索引

---

## ipcMain.handle("project:rag-stats", async (_event, projectId) =>

```javascript
ipcMain.handle("project:rag-stats", async (_event, projectId) =>
```

* 获取索引统计（新版）
   * 使用 RAGAPI 获取索引统计信息

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* RAG 增强查询（新版）
   * 使用 RAGAPI 进行向量检索

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新文件索引（新版）
   * 使用 RAGAPI 更新指定文件的索引

---

## ipcMain.handle("project:rag-delete", async (_event, projectId) =>

```javascript
ipcMain.handle("project:rag-delete", async (_event, projectId) =>
```

* 删除项目索引（新版）
   * 使用 RAGAPI 删除项目的所有索引

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 增量索引项目文件
   * 通过 content hash 检测变化，避免重复索引

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 多文件联合检索
   * 支持文件关系追踪和跨文件上下文聚合

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取文件关系（导入/被导入）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 统一检索（知识库-项目-对话联合）
   * 并行检索3个数据源，应用来源权重

---

## ipcMain.handle("project:updateRetrieveWeights", async (_event, weights) =>

```javascript
ipcMain.handle("project:updateRetrieveWeights", async (_event, weights) =>
```

* 更新检索权重
   * 调整项目/对话/知识库的检索权重

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 项目感知重排序
   * 基于项目上下文优化检索结果排序

---

