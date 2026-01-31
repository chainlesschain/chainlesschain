# rag-api

**Source**: `src\main\project\rag-api.js`

**Generated**: 2026-01-27T06:44:03.826Z

---

## async function indexProject(projectId, projectPath)

```javascript
async function indexProject(projectId, projectPath)
```

* RAG API - Project RAG indexing and query API
 * 提供项目级别的 RAG 索引和查询功能
 *
 * @module rag-api
 * @description 项目 RAG 向量检索 API (Placeholder implementation)

---

## async function indexProject(projectId, projectPath)

```javascript
async function indexProject(projectId, projectPath)
```

* 索引项目
 * @param {string} projectId - 项目ID
 * @param {string} projectPath - 项目路径
 * @returns {Promise<Object>} { success: boolean, error?: string }

---

## async function getIndexStats(projectId)

```javascript
async function getIndexStats(projectId)
```

* 获取索引统计
 * @param {string} projectId - 项目ID
 * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

## async function enhancedQuery(projectId, query, topK = 5)

```javascript
async function enhancedQuery(projectId, query, topK = 5)
```

* RAG 增强查询
 * @param {string} projectId - 项目ID
 * @param {string} query - 查询字符串
 * @param {number} topK - 返回结果数量
 * @returns {Promise<Object>} { success: boolean, results?: Array, error?: string }

---

## async function updateFileIndex(projectId, filePath, content)

```javascript
async function updateFileIndex(projectId, filePath, content)
```

* 更新文件索引
 * @param {string} projectId - 项目ID
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容
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

