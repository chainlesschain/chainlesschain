# rag-api

**Source**: `src/main/project/rag-api.js`

**Generated**: 2026-02-16T13:44:34.628Z

---

## let projectRAGManager = null;

```javascript
let projectRAGManager = null;
```

* RAG API - Project RAG indexing and query API
 * 提供项目级别的 RAG 索引和查询功能
 *
 * @module rag-api
 * @description 项目 RAG 向量检索 API - 委托给 ProjectRAGManager 实现

---

## async function getManager()

```javascript
async function getManager()
```

* 获取并初始化 ProjectRAGManager
 * @returns {Promise<Object>} ProjectRAGManager 实例

---

## async function indexProject(projectId, projectPath = null, options =

```javascript
async function indexProject(projectId, projectPath = null, options =
```

* 索引项目
 * @param {string} projectId - 项目ID
 * @param {string} projectPath - 项目路径 (可选，将从数据库获取)
 * @param {Object} options - 索引选项
 * @param {boolean} options.forceReindex - 是否强制重新索引
 * @param {string[]} options.fileTypes - 限定文件类型
 * @param {boolean} options.enableWatcher - 是否启用文件监听
 * @param {Function} options.onProgress - 进度回调
 * @returns {Promise<Object>} { success: boolean, error?: string, ... }

---

## async function getIndexStats(projectId)

```javascript
async function getIndexStats(projectId)
```

* 获取索引统计
 * @param {string} projectId - 项目ID
 * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

## async function enhancedQuery(projectId, query, topK = 5, options =

```javascript
async function enhancedQuery(projectId, query, topK = 5, options =
```

* RAG 增强查询
 * @param {string} projectId - 项目ID
 * @param {string} query - 查询字符串
 * @param {number} topK - 返回结果数量
 * @param {Object} options - 查询选项
 * @param {number} options.projectLimit - 项目文件检索数量
 * @param {number} options.knowledgeLimit - 知识库检索数量
 * @param {number} options.conversationLimit - 对话历史检索数量
 * @param {boolean} options.useReranker - 是否使用重排序
 * @returns {Promise<Object>} { success: boolean, results?: Array, error?: string }

---

## async function updateFileIndex(projectId, filePath, _content = null)

```javascript
async function updateFileIndex(projectId, filePath, _content = null)
```

* 更新文件索引
 * @param {string} projectId - 项目ID
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容 (可选，将从文件系统读取)
 * @returns {Promise<Object>} { success: boolean, error?: string }

---

## async function deleteProjectIndex(projectId)

```javascript
async function deleteProjectIndex(projectId)
```

* 删除项目索引
 * @param {string} projectId - 项目ID
 * @returns {Promise<Object>} { success: boolean, error?: string }

---

## async function indexConversationHistory(projectId, options =

```javascript
async function indexConversationHistory(projectId, options =
```

* 索引项目对话历史
 * @param {string} projectId - 项目ID
 * @param {Object} options - 选项
 * @param {number} options.limit - 对话数量限制
 * @returns {Promise<Object>} { success: boolean, error?: string, ... }

---

## async function startFileWatcher(projectId, projectPath)

```javascript
async function startFileWatcher(projectId, projectPath)
```

* 启动文件监听
 * @param {string} projectId - 项目ID
 * @param {string} projectPath - 项目路径
 * @returns {Promise<Object>} { success: boolean, error?: string }

---

## async function stopFileWatcher(projectId)

```javascript
async function stopFileWatcher(projectId)
```

* 停止文件监听
 * @param {string} projectId - 项目ID
 * @returns {Promise<Object>} { success: boolean, error?: string }

---

## async function getEventEmitter()

```javascript
async function getEventEmitter()
```

* 获取 ProjectRAGManager 事件发射器
 * 用于监听索引进度等事件
 * @returns {Promise<EventEmitter>} ProjectRAGManager 实例

---

