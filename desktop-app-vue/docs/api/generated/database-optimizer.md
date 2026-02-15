# database-optimizer

**Source**: `src/main/database/database-optimizer.js`

**Generated**: 2026-02-15T10:10:53.428Z

---

## const

```javascript
const
```

* 数据库性能优化模块
 *
 * 功能：
 * - 查询性能监控
 * - 查询缓存
 * - 批量操作优化
 * - 索引建议
 * - 慢查询日志
 * - 数据库统计信息

---

## class QueryCache

```javascript
class QueryCache
```

* 查询缓存类

---

## generateKey(sql, params = [])

```javascript
generateKey(sql, params = [])
```

* 生成缓存键

---

## get(sql, params = [])

```javascript
get(sql, params = [])
```

* 获取缓存

---

## set(sql, params = [], data)

```javascript
set(sql, params = [], data)
```

* 设置缓存

---

## clear()

```javascript
clear()
```

* 清空缓存

---

## invalidate(pattern)

```javascript
invalidate(pattern)
```

* 使缓存失效（支持模式匹配）

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## class DatabaseOptimizer

```javascript
class DatabaseOptimizer
```

* 数据库性能优化器类

---

## async query(sql, params = [], options =

```javascript
async query(sql, params = [], options =
```

* 执行查询（带性能监控）

---

## isSelectQuery(sql)

```javascript
isSelectQuery(sql)
```

* 判断是否为SELECT查询

---

## recordQueryPerformance(sql, params, duration)

```javascript
recordQueryPerformance(sql, params, duration)
```

* 记录查询性能

---

## generateIndexSuggestion(sql, duration)

```javascript
generateIndexSuggestion(sql, duration)
```

* 生成索引建议

---

## async batchInsert(table, records, options =

```javascript
async batchInsert(table, records, options =
```

* 批量插入优化

---

## async batchUpdate(table, updates, idColumn = "id", options =

```javascript
async batchUpdate(table, updates, idColumn = "id", options =
```

* 批量更新优化

---

## analyzeTable(tableName)

```javascript
analyzeTable(tableName)
```

* 分析表性能

---

## generateTableSuggestions(tableName, columns, indexes)

```javascript
generateTableSuggestions(tableName, columns, indexes)
```

* 生成表优化建议

---

## async optimize()

```javascript
async optimize()
```

* 优化数据库

---

## getStats()

```javascript
getStats()
```

* 获取性能统计

---

## resetStats()

```javascript
resetStats()
```

* 重置统计信息

---

## getSlowQueries(limit = 20)

```javascript
getSlowQueries(limit = 20)
```

* 获取慢查询日志

---

## getIndexSuggestions()

```javascript
getIndexSuggestions()
```

* 获取索引建议

---

## applyIndexSuggestion(suggestion)

```javascript
applyIndexSuggestion(suggestion)
```

* 应用索引建议

---

## applyAllIndexSuggestions()

```javascript
applyAllIndexSuggestions()
```

* 应用所有索引建议

---

