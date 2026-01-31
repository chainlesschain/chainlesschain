# project-rag

**Source**: `src\main\project\project-rag.js`

**Generated**: 2026-01-27T06:44:03.826Z

---

## const

```javascript
const
```

* 项目RAG管理器
 * 负责项目文件的向量化索引、检索增强和知识库集成

---

## async initialize()

```javascript
async initialize()
```

* 初始化项目RAG系统

---

## ensureInitialized()

```javascript
ensureInitialized()
```

* 确保已初始化

---

## async indexProjectFiles(projectId, options =

```javascript
async indexProjectFiles(projectId, options =
```

* 索引项目文件
   * @param {string} projectId - 项目ID
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调 (current, total, fileName)
   * @returns {Promise<Object>} 索引结果

---

## async readFileContent(file)

```javascript
async readFileContent(file)
```

* 读取文件内容
   * @param {Object} file - 文件对象
   * @returns {Promise<string>} 文件内容

---

## async enhancedQuery(projectId, query, options =

```javascript
async enhancedQuery(projectId, query, options =
```

* 项目AI增强查询
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 增强的上下文

---

## async searchConversationHistory(projectId, query, limit)

```javascript
async searchConversationHistory(projectId, query, limit)
```

* 搜索对话历史
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {number} limit - 返回数量
   * @returns {Promise<Array>} 对话记录

---

## generateContextSummary(docs)

```javascript
generateContextSummary(docs)
```

* 生成上下文摘要
   * @param {Array} docs - 文档列表
   * @returns {string} 摘要文本

---

## async deleteProjectIndex(projectId)

```javascript
async deleteProjectIndex(projectId)
```

* 删除项目索引
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 删除结果

---

## async updateFileIndex(fileId)

```javascript
async updateFileIndex(fileId)
```

* 更新单个文件索引
   * @param {string} fileId - 文件ID
   * @returns {Promise<Object>} 更新结果

---

## async getIndexStats(projectId)

```javascript
async getIndexStats(projectId)
```

* 获取项目索引统计
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 统计信息

---

## async startFileWatcher(projectId, projectPath)

```javascript
async startFileWatcher(projectId, projectPath)
```

* 启动文件监听
   * @param {string} projectId - 项目ID
   * @param {string} projectPath - 项目路径

---

## stopFileWatcher(projectId)

```javascript
stopFileWatcher(projectId)
```

* 停止文件监听
   * @param {string} projectId - 项目ID

---

## async handleFileChange(projectId, filePath, changeType)

```javascript
async handleFileChange(projectId, filePath, changeType)
```

* 处理文件变化
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @param {string} changeType - 变化类型 (add/change/delete)

---

## async indexConversationHistory(projectId, options =

```javascript
async indexConversationHistory(projectId, options =
```

* 索引项目对话历史
   * @param {string} projectId - 项目ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 索引结果

---

## function getProjectRAGManager()

```javascript
function getProjectRAGManager()
```

* 获取项目RAG管理器实例
 * @returns {ProjectRAGManager}

---

