# rag-manager

**Source**: `src/main/rag/rag-manager.js`

**Generated**: 2026-02-21T22:04:25.794Z

---

## const

```javascript
const
```

* RAG (Retrieval-Augmented Generation) 管理器
 *
 * 负责知识库检索和增强生成

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* RAG配置

---

## class RAGManager extends EventEmitter

```javascript
class RAGManager extends EventEmitter
```

* RAG管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化RAG管理器

---

## async buildVectorIndex()

```javascript
async buildVectorIndex()
```

* 构建向量索引

---

## async retrieve(query, options =

```javascript
async retrieve(query, options =
```

* 检索相关知识
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 相关知识列表

---

## _deduplicateResults(results)

```javascript
_deduplicateResults(results)
```

* 去重结果
   * @private

---

## async vectorSearch(query, topK = 5)

```javascript
async vectorSearch(query, topK = 5)
```

* 向量搜索
   * @param {string} query - 查询文本
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 搜索结果

---

## async keywordSearch(query, topK = 5)

```javascript
async keywordSearch(query, topK = 5)
```

* 关键词搜索
   * @param {string} query - 查询文本
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 搜索结果

---

## mergeResults(vectorResults, keywordResults)

```javascript
mergeResults(vectorResults, keywordResults)
```

* 合并搜索结果
   * @param {Array} vectorResults - 向量搜索结果
   * @param {Array} keywordResults - 关键词搜索结果
   * @returns {Array} 合并后的结果

---

## buildEnhancedContext(query, retrievedDocs)

```javascript
buildEnhancedContext(query, retrievedDocs)
```

* 构建增强上下文
   * @param {string} query - 用户查询
   * @param {Array} retrievedDocs - 检索到的文档
   * @returns {string} 增强上下文

---

## async enhanceQuery(query, options =

```javascript
async enhanceQuery(query, options =
```

* RAG增强查询
   * @param {string} query - 用户查询
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 增强后的查询信息

---

## async addToIndex(item)

```javascript
async addToIndex(item)
```

* 添加文档到索引
   * @param {Object} item - 知识库项

---

## async removeFromIndex(itemId)

```javascript
async removeFromIndex(itemId)
```

* 从索引中移除文档
   * @param {string} itemId - 知识库项ID

---

## async updateIndex(item)

```javascript
async updateIndex(item)
```

* 更新索引中的文档
   * @param {Object} item - 知识库项

---

## async rebuildIndex()

```javascript
async rebuildIndex()
```

* 重建索引

---

## async getIndexStats()

```javascript
async getIndexStats()
```

* 获取索引统计

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置

---

## getRerankConfig()

```javascript
getRerankConfig()
```

* 获取重排序器配置

---

## setRerankingEnabled(enabled)

```javascript
setRerankingEnabled(enabled)
```

* 启用/禁用重排序

---

## getPerformanceMetrics(type = null)

```javascript
getPerformanceMetrics(type = null)
```

* 获取性能指标
   * @param {string} type - 指标类型（可选）
   * @returns {Object} 性能统计

---

## getRealTimeMetrics()

```javascript
getRealTimeMetrics()
```

* 获取实时性能概览
   * @returns {Object} 实时性能数据

---

## getPerformanceReport(timeRange = 3600000)

```javascript
getPerformanceReport(timeRange = 3600000)
```

* 获取性能报告
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Object} 性能报告

---

## resetMetrics()

```javascript
resetMetrics()
```

* 重置性能指标

---

## setMetricsEnabled(enabled)

```javascript
setMetricsEnabled(enabled)
```

* 启用/禁用性能监控

---

## async addDocument(doc)

```javascript
async addDocument(doc)
```

* 添加文档（兼容ProjectRAG接口）
   * @param {Object} doc - 文档对象
   * @returns {Promise<void>}

---

## async getDocument(id)

```javascript
async getDocument(id)
```

* 获取文档（兼容ProjectRAG接口）
   * @param {string} id - 文档ID
   * @returns {Promise<Object|null>}

---

## async deleteDocument(id)

```javascript
async deleteDocument(id)
```

* 删除文档（兼容ProjectRAG接口）
   * @param {string} id - 文档ID
   * @returns {Promise<void>}

---

## async search(query, options =

```javascript
async search(query, options =
```

* 搜索文档（兼容ProjectRAG接口）
   * @param {string} query - 查询文本
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>}

---

## async rerank(query, documents, options =

```javascript
async rerank(query, documents, options =
```

* 重排序文档（兼容ProjectRAG接口）
   * @param {string} query - 查询文本
   * @param {Array} documents - 文档列表
   * @param {Object} options - 重排序选项
   * @returns {Promise<Array>}

---

## function getRAGManager(databaseManager = null, llmManager = null, config =

```javascript
function getRAGManager(databaseManager = null, llmManager = null, config =
```

* 获取RAG管理器单例实例
 * @param {Object} databaseManager - 数据库管理器
 * @param {Object} llmManager - LLM管理器
 * @param {Object} config - 配置选项
 * @returns {RAGManager}

---

