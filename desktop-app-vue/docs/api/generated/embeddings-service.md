# embeddings-service

**Source**: `src\main\rag\embeddings-service.js`

**Generated**: 2026-01-27T06:44:03.825Z

---

## const

```javascript
const
```

* 嵌入向量服务
 *
 * 负责文本向量化和相似度计算

---

## class EmbeddingsService extends EventEmitter

```javascript
class EmbeddingsService extends EventEmitter
```

* 嵌入向量服务类

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

## clearCache()

```javascript
clearCache()
```

* 清除缓存

---

## getCacheStats()

```javascript
getCacheStats()
```

* 获取缓存统计

---

