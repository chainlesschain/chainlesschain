# project-rag-ipc

**Source**: `src\main\project\project-rag-ipc.js`

**Generated**: 2026-01-27T06:44:03.826Z

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

## ipcMain.handle('project:indexFiles', async (_event, projectId, options =

```javascript
ipcMain.handle('project:indexFiles', async (_event, projectId, options =
```

* 索引项目文件
   * 将项目中的所有文件建立向量索引

---

## ipcMain.handle('project:ragQuery', async (_event, projectId, query, options =

```javascript
ipcMain.handle('project:ragQuery', async (_event, projectId, query, options =
```

* RAG 增强查询（旧版）
   * 使用向量检索增强的查询功能

---

## ipcMain.handle('project:updateFileIndex', async (_event, fileId) =>

```javascript
ipcMain.handle('project:updateFileIndex', async (_event, fileId) =>
```

* 更新单个文件索引
   * 当文件内容变化时更新其向量索引

---

## ipcMain.handle('project:deleteIndex', async (_event, projectId) =>

```javascript
ipcMain.handle('project:deleteIndex', async (_event, projectId) =>
```

* 删除项目索引
   * 删除项目的所有向量索引数据

---

## ipcMain.handle('project:getIndexStats', async (_event, projectId) =>

```javascript
ipcMain.handle('project:getIndexStats', async (_event, projectId) =>
```

* 获取项目索引统计
   * 获取项目索引的文档数量、向量维度等统计信息

---

## ipcMain.handle('project:rag-index', async (_event, projectId, repoPath) =>

```javascript
ipcMain.handle('project:rag-index', async (_event, projectId, repoPath) =>
```

* 索引项目（新版）
   * 使用 RAGAPI 建立项目索引

---

## ipcMain.handle('project:rag-stats', async (_event, projectId) =>

```javascript
ipcMain.handle('project:rag-stats', async (_event, projectId) =>
```

* 获取索引统计（新版）
   * 使用 RAGAPI 获取索引统计信息

---

## ipcMain.handle('project:rag-query', async (_event, projectId, query, topK = 5) =>

```javascript
ipcMain.handle('project:rag-query', async (_event, projectId, query, topK = 5) =>
```

* RAG 增强查询（新版）
   * 使用 RAGAPI 进行向量检索

---

## ipcMain.handle('project:rag-update-file', async (_event, projectId, filePath, content) =>

```javascript
ipcMain.handle('project:rag-update-file', async (_event, projectId, filePath, content) =>
```

* 更新文件索引（新版）
   * 使用 RAGAPI 更新指定文件的索引

---

## ipcMain.handle('project:rag-delete', async (_event, projectId) =>

```javascript
ipcMain.handle('project:rag-delete', async (_event, projectId) =>
```

* 删除项目索引（新版）
   * 使用 RAGAPI 删除项目的所有索引

---

