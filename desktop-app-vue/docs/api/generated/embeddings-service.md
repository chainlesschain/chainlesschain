# embeddings-service

**Source**: `src/main/rag/embeddings-service.js`

**Generated**: 2026-02-15T07:37:13.795Z

---

## const

```javascript
const
```

* 嵌入向量服务
 *
 * 负责文本向量化和相似度计算
 * 支持双层缓存：内存 LRU 缓存 + SQLite 持久化缓存

---

## class EmbeddingsService extends EventEmitter

```javascript
class EmbeddingsService extends EventEmitter
```

* 嵌入向量服务类

---

## constructor(llmManager, options =

```javascript
constructor(llmManager, options =
```

* 创建嵌入向量服务
   * @param {Object} llmManager - LLM 管理器实例
   * @param {Object} options - 配置选项
   * @param {Object} [options.database] - 数据库实例（用于持久化缓存）
   * @param {boolean} [options.enablePersistentCache=true] - 启用持久化缓存
   * @param {string} [options.defaultModel='default'] - 默认模型名称

---

## async initialize()

```javascript
async initialize()
```

* 初始化服务

---

## async generateEmbedding(text, options =

```javascript
async generateEmbedding(text, options =
```

* 生成文本嵌入向量
   * @param {string} text - 文本内容
   * @param {Object} options - 选项
   * @param {boolean} [options.skipCache=false] - 跳过缓存
   * @param {string} [options.model] - 模型名称
   * @returns {Promise<Array>} 向量数组

---

## async generateEmbeddings(texts, options =

```javascript
async generateEmbeddings(texts, options =
```

* 批量生成嵌入向量
   * @param {Array<string>} texts - 文本数组
   * @param {Object} options - 选项
   * @returns {Promise<Array<Array>>} 向量数组

---

## cosineSimilarity(vec1, vec2)

```javascript
cosineSimilarity(vec1, vec2)
```

* 计算余弦相似度
   * @param {Array} vec1 - 向量1
   * @param {Array} vec2 - 向量2
   * @returns {number} 相似度 (0-1)

---

## generateSimpleEmbedding(text)

```javascript
generateSimpleEmbedding(text)
```

* 生成简单的文本嵌入（降级方案）
   * 使用TF-IDF和词频特征
   * @param {string} text - 文本内容
   * @returns {Array} 简化的向量

---

## getCacheKey(text)

```javascript
getCacheKey(text)
```

* 获取缓存键
   * @param {string} text - 文本
   * @returns {string} 缓存键

---

## clearCache(options =

```javascript
clearCache(options =
```

* 清除缓存
   * @param {Object} options - 选项
   * @param {boolean} [options.clearPersistent=false] - 是否同时清除持久化缓存

---

## getCacheStats()

```javascript
getCacheStats()
```

* 获取缓存统计

---

## startPersistentCacheCleanup()

```javascript
startPersistentCacheCleanup()
```

* 启动持久化缓存自动清理

---

## stopPersistentCacheCleanup()

```javascript
stopPersistentCacheCleanup()
```

* 停止持久化缓存自动清理

---

## destroy()

```javascript
destroy()
```

* 销毁服务

---

