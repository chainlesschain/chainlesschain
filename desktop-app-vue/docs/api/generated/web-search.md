# web-search

**Source**: `src/main/utils/web-search.js`

**Generated**: 2026-02-22T01:23:36.656Z

---

## const

```javascript
const
```

* 通用联网搜索工具
 * 支持多个搜索引擎，不依赖特定LLM提供商

---

## async function searchFallback(query, options =

```javascript
async function searchFallback(query, options =
```

* 使用简单的搜索建议作为备选方案
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 模拟搜索结果

---

## async function searchDuckDuckGo(query, options =

```javascript
async function searchDuckDuckGo(query, options =
```

* DuckDuckGo即时回答API搜索（无需API key）
 * 注意：DuckDuckGo的API有时不稳定，作为备选方案
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果

---

## async function searchBing(query, options =

```javascript
async function searchBing(query, options =
```

* 使用Bing搜索API（如果配置了API key）
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果

---

## async function search(query, options =

```javascript
async function search(query, options =
```

* 通用搜索接口（自动选择可用的搜索引擎）
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果

---

## function formatSearchResults(searchResult)

```javascript
function formatSearchResults(searchResult)
```

* 格式化搜索结果为文本
 * @param {Object} searchResult - 搜索结果
 * @returns {string} 格式化的文本

---

## async function enhanceChatWithSearch(

```javascript
async function enhanceChatWithSearch(
```

* 使用搜索结果增强LLM对话
 * @param {string} userQuery - 用户查询
 * @param {Array} messages - 对话历史
 * @param {Function} llmChat - LLM对话函数
 * @param {Object} options - 选项
 * @returns {Promise<Object>} LLM响应

---

