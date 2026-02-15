# vector-store

**Source**: `src/main/vector/vector-store.js`

**Generated**: 2026-02-15T10:10:53.355Z

---

## const

```javascript
const
```

* 向量存储服务
 *
 * 使用ChromaDB进行向量存储和检索

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 向量存储配置

---

## class VectorStore extends EventEmitter

```javascript
class VectorStore extends EventEmitter
```

* 向量存储管理类

---

## async initialize()

```javascript
async initialize()
```

* 初始化向量存储

---

## async checkConnection()

```javascript
async checkConnection()
```

* 检查ChromaDB连接

---

## async getOrCreateCollection()

```javascript
async getOrCreateCollection()
```

* 获取或创建集合

---

## async addVector(item, embedding)

```javascript
async addVector(item, embedding)
```

* 添加向量
   * @param {Object} item - 知识库项
   * @param {Array} embedding - 嵌入向量

---

## async addVectorsBatch(items, embeddings)

```javascript
async addVectorsBatch(items, embeddings)
```

* 批量添加向量
   * @param {Array} items - 知识库项数组
   * @param {Array} embeddings - 嵌入向量数组

---

## async updateVector(id, embedding, metadata)

```javascript
async updateVector(id, embedding, metadata)
```

* 更新向量
   * @param {string} id - 项目ID
   * @param {Array} embedding - 新的嵌入向量
   * @param {Object} metadata - 新的元数据

---

## async deleteVector(id)

```javascript
async deleteVector(id)
```

* 删除向量
   * @param {string} id - 项目ID

---

## async search(queryEmbedding, topK = null, filter = null)

```javascript
async search(queryEmbedding, topK = null, filter = null)
```

* 搜索相似向量
   * @param {Array} queryEmbedding - 查询向量
   * @param {number} topK - 返回数量
   * @param {Object} filter - 过滤条件

---

## searchMemory(queryEmbedding, topK)

```javascript
searchMemory(queryEmbedding, topK)
```

* 内存模式搜索
   * @param {Array} queryEmbedding - 查询向量
   * @param {number} topK - 返回数量

---

## cosineSimilarity(vecA, vecB)

```javascript
cosineSimilarity(vecA, vecB)
```

* 计算余弦相似度

---

## async getStats()

```javascript
async getStats()
```

* 获取统计信息

---

## async clear()

```javascript
async clear()
```

* 清空所有向量

---

## async rebuildIndex(items, embeddingFn)

```javascript
async rebuildIndex(items, embeddingFn)
```

* 重建索引
   * @param {Array} items - 所有知识库项
   * @param {Function} embeddingFn - 嵌入函数

---

## async close()

```javascript
async close()
```

* 关闭连接

---

