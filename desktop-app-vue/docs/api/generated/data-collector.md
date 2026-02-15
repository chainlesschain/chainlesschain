# data-collector

**Source**: `src/main/ai-engine/data-collector.js`

**Generated**: 2026-02-15T07:37:13.871Z

---

## class DataCollector

```javascript
class DataCollector
```

* DataCollector - 数据收集模块
 * P2智能层数据收集基础设施
 *
 * 功能:
 * - 收集工具使用事件
 * - 记录推荐行为
 * - 更新用户画像
 * - 数据验证与清洗
 * - 批量写入优化
 *
 * Version: v0.21.0
 * Date: 2026-01-02

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库连接

---

## async collectToolUsage(event)

```javascript
async collectToolUsage(event)
```

* 收集工具使用事件
   * @param {Object} event - 事件对象

---

## async collectRecommendation(recommendation)

```javascript
async collectRecommendation(recommendation)
```

* 记录推荐事件
   * @param {Object} recommendation - 推荐对象

---

## async updateUserProfile(userId, updates)

```javascript
async updateUserProfile(userId, updates)
```

* 更新用户画像统计
   * @param {string} userId - 用户ID
   * @param {Object} updates - 更新数据

---

## async createUserProfile(userId, initialData =

```javascript
async createUserProfile(userId, initialData =
```

* 创建新用户画像

---

## async flush()

```javascript
async flush()
```

* 刷新缓冲区到数据库

---

## writeToolUsageEvent(event)

```javascript
writeToolUsageEvent(event)
```

* 写入工具使用事件

---

## writeRecommendation(rec)

```javascript
writeRecommendation(rec)
```

* 写入推荐记录

---

## validateToolUsageEvent(event)

```javascript
validateToolUsageEvent(event)
```

* 验证工具使用事件

---

## validateRecommendation(rec)

```javascript
validateRecommendation(rec)
```

* 验证推荐记录

---

## cleanToolUsageEvent(event)

```javascript
cleanToolUsageEvent(event)
```

* 清洗工具使用事件数据

---

## cleanRecommendation(rec)

```javascript
cleanRecommendation(rec)
```

* 清洗推荐数据

---

## anonymizeIfNeeded(userId)

```javascript
anonymizeIfNeeded(userId)
```

* 匿名化用户ID（如果启用）

---

## sanitizeContext(context)

```javascript
sanitizeContext(context)
```

* 清理上下文数据

---

## startFlushTimer()

```javascript
startFlushTimer()
```

* 启动定时刷新

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

