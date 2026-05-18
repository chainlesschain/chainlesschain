# globalSearchManager

**Source**: `src\renderer\utils\globalSearchManager.js`

**Generated**: 2026-01-27T06:44:03.899Z

---

## import

```javascript
import
```

* 全局搜索管理器
 * 提供跨模块的统一搜索功能

---

## export const SearchType =

```javascript
export const SearchType =
```

* 搜索类型

---

## class SearchResult

```javascript
class SearchResult
```

* 搜索结果类

---

## class SearchIndex

```javascript
class SearchIndex
```

* 搜索索引类

---

## add(item)

```javascript
add(item)
```

* 添加项目到索引

---

## remove(itemId)

```javascript
remove(itemId)
```

* 从索引中移除项目

---

## search(query, options =

```javascript
search(query, options =
```

* 搜索

---

## tokenize(text)

```javascript
tokenize(text)
```

* 分词

---

## calculateScore(item, queryWords)

```javascript
calculateScore(item, queryWords)
```

* 计算相关性分数

---

## clear()

```javascript
clear()
```

* 清空索引

---

## size()

```javascript
size()
```

* 获取索引大小

---

## class GlobalSearchManager

```javascript
class GlobalSearchManager
```

* 全局搜索管理器

---

## registerProvider(type, provider)

```javascript
registerProvider(type, provider)
```

* 注册搜索提供者

---

## addToIndex(type, item)

```javascript
addToIndex(type, item)
```

* 添加项目到索引

---

## addBatchToIndex(type, items)

```javascript
addBatchToIndex(type, items)
```

* 批量添加项目到索引

---

## removeFromIndex(type, itemId)

```javascript
removeFromIndex(type, itemId)
```

* 从索引中移除项目

---

## async search(query, options =

```javascript
async search(query, options =
```

* 全局搜索

---

## addToHistory(query)

```javascript
addToHistory(query)
```

* 添加到搜索历史

---

## clearHistory()

```javascript
clearHistory()
```

* 清空搜索历史

---

## getSuggestions(query, limit = 5)

```javascript
getSuggestions(query, limit = 5)
```

* 获取搜索建议

---

## getStatistics()

```javascript
getStatistics()
```

* 获取索引统计

---

## async rebuildIndex(type)

```javascript
async rebuildIndex(type)
```

* 重建索引

---

## saveHistory()

```javascript
saveHistory()
```

* 保存搜索历史

---

## loadHistory()

```javascript
loadHistory()
```

* 加载搜索历史

---

## export function useGlobalSearch()

```javascript
export function useGlobalSearch()
```

* 组合式函数：使用全局搜索

---

