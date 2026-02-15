# bge-reranker-client

**Source**: `src/main/rag/bge-reranker-client.js`

**Generated**: 2026-02-15T07:37:13.796Z

---

## const

```javascript
const
```

* BGE Reranker 客户端
 *
 * 支持 BAAI/bge-reranker-base 和 bge-reranker-large 模型
 * 用于对 RAG 检索结果进行高质量重排序
 *
 * @module bge-reranker-client
 * @version 1.0.0

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class BGERerankerClient extends EventEmitter

```javascript
class BGERerankerClient extends EventEmitter
```

* BGE Reranker 客户端类

---

## async checkStatus()

```javascript
async checkStatus()
```

* 检查服务状态
   * @returns {Promise<Object>} 服务状态

---

## async rerank(query, documents, options =

```javascript
async rerank(query, documents, options =
```

* 重排序文档
   * @param {string} query - 查询文本
   * @param {Array} documents - 文档列表
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 重排序后的文档列表

---

## async _rerankSingle(requestData, options)

```javascript
async _rerankSingle(requestData, options)
```

* 单次重排序请求
   * @private

---

## async _rerankBatch(requestData, options)

```javascript
async _rerankBatch(requestData, options)
```

* 批量重排序（大数据集）
   * @private

---

## calculateHybridScore(documents, weights =

```javascript
calculateHybridScore(documents, weights =
```

* 计算混合分数（BGE + 向量相似度）
   * @param {Array} documents - 已有 BGE 分数的文档列表
   * @param {Object} weights - 权重配置
   * @returns {Array} 带混合分数的文档列表

---

## _extractText(doc)

```javascript
_extractText(doc)
```

* 从文档中提取文本
   * @private

---

## _sleep(ms)

```javascript
_sleep(ms)
```

* 睡眠函数
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取统计数据
   * @returns {Object} 统计数据

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置
   * @param {Object} newConfig - 新配置

---

## resetStats()

```javascript
resetStats()
```

* 重置统计数据

---

## function getBGERerankerClient(config =

```javascript
function getBGERerankerClient(config =
```

* 获取 BGERerankerClient 单例
 * @param {Object} config - 配置（仅首次调用时生效）
 * @returns {BGERerankerClient}

---

