# reranker

**Source**: `src/main/rag/reranker.js`

**Generated**: 2026-02-15T10:10:53.384Z

---

## const

```javascript
const
```

* Reranker - 重排序模块
 * 用于对检索结果进行二次排序，提升 RAG 检索质量
 *
 * v0.27.0: 新增 BGE Reranker 支持

---

## async rerank(query, documents, options =

```javascript
async rerank(query, documents, options =
```

* 重排序检索结果
   * @param {string} query - 用户查询
   * @param {Array} documents - 初步检索的文档列表
   * @param {Object} options - 配置选项
   * @returns {Array} - 重排序后的文档列表

---

## async rerankWithLLM(query, documents, topK)

```javascript
async rerankWithLLM(query, documents, topK)
```

* 使用 LLM 进行重排序
   * 通过 LLM 评估每个文档与查询的相关性

---

## buildRerankPrompt(query, documents)

```javascript
buildRerankPrompt(query, documents)
```

* 构建重排序提示词

---

## parseLLMScores(response, expectedCount)

```javascript
parseLLMScores(response, expectedCount)
```

* 解析 LLM 返回的评分

---

## async rerankWithCrossEncoder(query, documents, topK)

```javascript
async rerankWithCrossEncoder(query, documents, topK)
```

* 使用 Cross-Encoder 模型重排序
   * 支持远程API和本地关键词回退

---

## async rerankHybrid(query, documents, topK)

```javascript
async rerankHybrid(query, documents, topK)
```

* 混合重排序（结合多种方法）

---

## rerankWithKeywordMatch(query, documents, topK)

```javascript
rerankWithKeywordMatch(query, documents, topK)
```

* 简单的基于关键词匹配的重排序（无需 LLM）
   * 用于快速重排序或 LLM 不可用时

---

## tokenize(text)

```javascript
tokenize(text)
```

* 简单分词（按空格和标点分割）

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

* 启用/禁用重排序

---

## _initBGEClient()

```javascript
_initBGEClient()
```

* 初始化 BGE Reranker 客户端
   * @returns {Object} BGE 客户端实例

---

## async rerankWithBGE(query, documents, topK)

```javascript
async rerankWithBGE(query, documents, topK)
```

* 使用 BGE Reranker 进行重排序
   * @param {string} query - 用户查询
   * @param {Array} documents - 文档列表
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 重排序后的文档列表

---

## async rerankWithBGEHybrid(query, documents, topK)

```javascript
async rerankWithBGEHybrid(query, documents, topK)
```

* 使用 BGE + 向量相似度混合重排序
   * @param {string} query - 用户查询
   * @param {Array} documents - 文档列表
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 重排序后的文档列表

---

## updateBGEConfig(bgeConfig)

```javascript
updateBGEConfig(bgeConfig)
```

* 更新 BGE 配置
   * @param {Object} bgeConfig - BGE 配置

---

## async checkBGEStatus()

```javascript
async checkBGEStatus()
```

* 检查 BGE 服务状态
   * @returns {Promise<Object>} BGE 服务状态

---

## getBGEStats()

```javascript
getBGEStats()
```

* 获取 BGE 统计数据
   * @returns {Object} BGE 统计数据

---

