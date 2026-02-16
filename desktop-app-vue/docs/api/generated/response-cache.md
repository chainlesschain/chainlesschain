# response-cache

**Source**: `src/main/llm/response-cache.js`

**Generated**: 2026-02-16T22:06:51.472Z

---

## const

```javascript
const
```

* 响应缓存模块
 * 实现 LLM 响应的智能缓存，减少重复调用
 *
 * 缓存策略：
 * 1. 精确匹配：使用 SHA-256 哈希对 (provider, model, messages) 进行缓存
 * 2. TTL 管理：缓存有效期为 7 天
 * 3. LRU 淘汰：缓存数量超过限制时，淘汰最久未使用的条目
 *
 * 目标：缓存命中率 >20%
 *
 * @module response-cache

---

## function calculateCacheKey(provider, model, messages)

```javascript
function calculateCacheKey(provider, model, messages)
```

* 计算缓存键（SHA-256 哈希）
 * @param {string} provider - 提供商
 * @param {string} model - 模型名称
 * @param {Array} messages - 消息数组
 * @returns {string} 缓存键

---

## constructor(database, options =

```javascript
constructor(database, options =
```

* 创建响应缓存
   * @param {Object} database - 数据库实例
   * @param {Object} options - 配置选项
   * @param {number} [options.ttl=604800000] - 缓存有效期（默认 7 天，单位：毫秒）
   * @param {number} [options.maxSize=1000] - 最大缓存条目数
   * @param {boolean} [options.enableAutoCleanup=true] - 启用自动清理过期缓存
   * @param {number} [options.cleanupInterval=3600000] - 清理间隔（默认 1 小时）

---

## async get(provider, model, messages, options =

```javascript
async get(provider, model, messages, options =
```

* 从缓存获取响应
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {Array} messages - 消息数组
   * @param {Object} options - 获取选项
   * @returns {Promise<Object>} {hit: boolean, response?: Object, tokensSaved?: number}

---

## async set(provider, model, messages, response, options =

```javascript
async set(provider, model, messages, response, options =
```

* 将响应存入缓存
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {Array} messages - 消息数组
   * @param {Object} response - LLM 响应对象
   * @param {Object} options - 存储选项
   * @returns {Promise<boolean>} 是否成功

---

## async clear()

```javascript
async clear()
```

* 清除所有缓存
   * @returns {Promise<number>} 清除的条目数

---

## async clearExpired()

```javascript
async clearExpired()
```

* 清除过期缓存
   * @returns {Promise<number>} 清除的条目数

---

## async getStats()

```javascript
async getStats()
```

* 获取缓存统计信息
   * @returns {Promise<Object>} 统计信息

---

## async getStatsByProvider()

```javascript
async getStatsByProvider()
```

* 按提供商获取缓存统计
   * @returns {Promise<Array>} 统计信息数组

---

## _updateHitStats(

```javascript
_updateHitStats(
```

* 更新命中统计（私有方法）
   * @private

---

## _deleteCache(cacheId)

```javascript
_deleteCache(cacheId)
```

* 删除缓存条目（私有方法）
   * @private

---

## async _enforceMaxSize()

```javascript
async _enforceMaxSize()
```

* 执行 LRU 淘汰（私有方法）
   * @private

---

## _estimateTokens(text)

```javascript
_estimateTokens(text)
```

* 估算 Token 数量（私有方法）
   * @private

---

## _startAutoCleanup()

```javascript
_startAutoCleanup()
```

* 启动自动清理任务（私有方法）
   * @private

---

## stopAutoCleanup()

```javascript
stopAutoCleanup()
```

* 停止自动清理任务

---

## destroy()

```javascript
destroy()
```

* 销毁缓存实例

---

