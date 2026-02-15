# query-rewriter

**Source**: `src/main/rag/query-rewriter.js`

**Generated**: 2026-02-15T08:42:37.201Z

---

## const

```javascript
const
```

* QueryRewriter - 查询重写器
 * 使用LLM生成查询变体，提升召回率和检索质量

---

## const DEFAULT_REWRITER_CONFIG =

```javascript
const DEFAULT_REWRITER_CONFIG =
```

* 查询重写配置

---

## class QueryRewriter extends EventEmitter

```javascript
class QueryRewriter extends EventEmitter
```

* 查询重写器类

---

## async rewriteQuery(query, options =

```javascript
async rewriteQuery(query, options =
```

* 重写查询
   * @param {string} query - 原始查询
   * @param {Object} options - 重写选项
   * @returns {Promise<Object>} 重写结果

---

## async multiQueryRewrite(query, options =

```javascript
async multiQueryRewrite(query, options =
```

* 多查询重写（Multi-Query）
   * 生成多个语义相似但表达不同的查询

---

## async hydeRewrite(query, options =

```javascript
async hydeRewrite(query, options =
```

* HyDE重写（Hypothetical Document Embeddings）
   * 生成假设的答案文档，然后用文档作为查询

---

## async stepBackRewrite(query, options =

```javascript
async stepBackRewrite(query, options =
```

* Step-Back重写
   * 生成更抽象、更高层次的查询

---

## async decomposeQuery(query, options =

```javascript
async decomposeQuery(query, options =
```

* 查询分解
   * 将复杂查询分解为多个子查询

---

## parseQueryVariants(response, maxCount = 3)

```javascript
parseQueryVariants(response, maxCount = 3)
```

* 解析LLM返回的查询变体
   * @private

---

## async rewriteQueries(queries, options =

```javascript
async rewriteQueries(queries, options =
```

* 批量重写查询

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

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置

---

## getConfig()

```javascript
getConfig()
```

* 获取当前配置

---

## setEnabled(enabled)

```javascript
setEnabled(enabled)
```

* 启用/禁用查询重写

---

