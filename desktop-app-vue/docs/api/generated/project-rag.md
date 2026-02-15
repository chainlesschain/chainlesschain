# project-rag

**Source**: `src/main/project/project-rag.js`

**Generated**: 2026-02-15T07:37:13.798Z

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

## class IncrementalIndexManager

```javascript
class IncrementalIndexManager
```

* 增量索引管理器
 * 通过 content hash 检测文件变化，避免重复索引

---

## _computeHash(content)

```javascript
_computeHash(content)
```

* 计算内容的 MD5 哈希
   * @param {string} content - 文件内容
   * @returns {string} MD5 哈希值

---

## async detectChanges(files, projectId)

```javascript
async detectChanges(files, projectId)
```

* 检测文件变化
   * @param {Array} files - 文件列表 [{id, content, ...}]
   * @param {string} projectId - 项目ID
   * @returns {Object} { toIndex, toUpdate, unchanged }

---

## async incrementalIndex(projectId, options =

```javascript
async incrementalIndex(projectId, options =
```

* 增量索引项目文件
   * @param {string} projectId - 项目ID
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 索引结果

---

## async cleanupIndexRecords(projectId)

```javascript
async cleanupIndexRecords(projectId)
```

* 清理项目的索引记录
   * @param {string} projectId - 项目ID

---

## class MultiFileRetriever

```javascript
class MultiFileRetriever
```

* 多文件联合检索器
 * 支持文件关系追踪和跨文件上下文聚合

---

## _extractImports(content, fileType)

```javascript
_extractImports(content, fileType)
```

* 提取文件中的导入语句
   * @param {string} content - 文件内容
   * @param {string} fileType - 文件类型
   * @returns {Array<string>} 导入的文件路径列表

---

## async _findRelatedFiles(fileIds, projectId, depth = 1)

```javascript
async _findRelatedFiles(fileIds, projectId, depth = 1)
```

* 查找相关文件
   * @param {Array<string>} fileIds - 初始文件ID列表
   * @param {string} projectId - 项目ID
   * @param {number} depth - 查找深度
   * @returns {Promise<Array>} 相关文件列表

---

## _groupByFile(chunks)

```javascript
_groupByFile(chunks)
```

* 按文件分组检索结果
   * @param {Array} chunks - 检索到的片段列表
   * @returns {Object} 按文件分组的结果

---

## async _buildJointContext(primaryFiles, relatedFiles)

```javascript
async _buildJointContext(primaryFiles, relatedFiles)
```

* 构建联合上下文
   * @param {Array} primaryFiles - 主要文件
   * @param {Array} relatedFiles - 关联文件
   * @returns {Object} 联合上下文

---

## async jointRetrieve(projectId, query, options =

```javascript
async jointRetrieve(projectId, query, options =
```

* 多文件联合检索
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 联合检索结果

---

## async getFileRelations(projectId, fileId)

```javascript
async getFileRelations(projectId, fileId)
```

* 获取文件关系
   * @param {string} projectId - 项目ID
   * @param {string} fileId - 文件ID
   * @returns {Promise<Object>} 文件关系

---

## class UnifiedRetriever

```javascript
class UnifiedRetriever
```

* 统一检索器
 * 知识库-项目-对话联合检索，支持来源权重

---

## updateWeights(weights)

```javascript
updateWeights(weights)
```

* 更新来源权重
   * @param {Object} weights - 新的权重配置

---

## _applySourceWeight(docs, source)

```javascript
_applySourceWeight(docs, source)
```

* 应用来源权重到文档分数
   * @param {Array} docs - 文档列表
   * @param {string} source - 来源类型
   * @returns {Array} 加权后的文档

---

## async unifiedRetrieve(projectId, query, options =

```javascript
async unifiedRetrieve(projectId, query, options =
```

* 统一检索
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 统一检索结果

---

## class ProjectAwareReranker

```javascript
class ProjectAwareReranker
```

* 项目感知重排序器
 * 基于项目上下文优化检索结果排序

---

## _applyProjectAwareWeights(docs, context)

```javascript
_applyProjectAwareWeights(docs, context)
```

* 应用项目感知权重
   * @param {Array} docs - 文档列表
   * @param {Object} context - 项目上下文
   * @returns {Array} 加权后的文档

---

## _getRelevantFileTypes(projectType)

```javascript
_getRelevantFileTypes(projectType)
```

* 根据项目类型获取相关文件类型
   * @param {string} projectType - 项目类型
   * @returns {Array<string>} 相关文件类型列表

---

## _applyCodeRelevance(docs, query, projectType)

```javascript
_applyCodeRelevance(docs, query, projectType)
```

* 应用代码相关性评分
   * @param {Array} docs - 文档列表
   * @param {string} query - 查询文本
   * @param {string} projectType - 项目类型
   * @returns {Array} 加权后的文档

---

## async rerank(query, documents, context =

```javascript
async rerank(query, documents, context =
```

* 项目感知重排序
   * @param {string} query - 查询文本
   * @param {Array} documents - 文档列表
   * @param {Object} context - 项目上下文
   * @returns {Promise<Array>} 重排序后的文档

---

## function getProjectRAGManager()

```javascript
function getProjectRAGManager()
```

* 获取项目RAG管理器实例
 * @returns {ProjectRAGManager}

---

## function getIncrementalIndexManager()

```javascript
function getIncrementalIndexManager()
```

* 获取增量索引管理器实例
 * @returns {IncrementalIndexManager}

---

## function getMultiFileRetriever()

```javascript
function getMultiFileRetriever()
```

* 获取多文件检索器实例
 * @returns {MultiFileRetriever}

---

## function getUnifiedRetriever()

```javascript
function getUnifiedRetriever()
```

* 获取统一检索器实例
 * @returns {UnifiedRetriever}

---

## function getProjectAwareReranker()

```javascript
function getProjectAwareReranker()
```

* 获取项目感知重排序器实例
 * @returns {ProjectAwareReranker}

---

