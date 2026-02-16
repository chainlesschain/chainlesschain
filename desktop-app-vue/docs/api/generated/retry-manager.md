# retry-manager

**Source**: `src/main/file/retry-manager.js`

**Generated**: 2026-02-16T13:44:34.664Z

---

## const

```javascript
const
```

* 自动重试管理器
 *
 * 职责：
 * - 提供通用的重试机制
 * - 实现指数退避策略
 * - 支持自定义重试条件
 * - 记录重试历史和统计

---

## const DEFAULT_RETRY_CONFIG =

```javascript
const DEFAULT_RETRY_CONFIG =
```

* 重试配置

---

## class RetryManager

```javascript
class RetryManager
```

* 重试管理器类

---

## async execute(fn, options =

```javascript
async execute(fn, options =
```

* 执行带重试的异步操作
   *
   * @param {Function} fn - 要执行的异步函数
   * @param {Object} [options={}] - 重试选项（会覆盖默认配置）
   * @param {string} [options.operationName] - 操作名称（用于日志）
   * @param {number} [options.maxRetries] - 最大重试次数
   * @param {number} [options.initialDelay] - 初始延迟
   * @param {Function} [options.onRetry] - 重试回调函数
   *
   * @returns {Promise<*>} 操作结果
   *
   * @example
   * const result = await retryManager.execute(
   *   async () => await fetchData(),
   *   {
   *     operationName: 'fetchData',
   *     maxRetries: 5,
   *     onRetry: (attempt, error) => console.log(`重试第${attempt}次: ${error.message}`)
   *   }
   * );

---

## calculateDelay(attempt, options =

```javascript
calculateDelay(attempt, options =
```

* 计算重试延迟（指数退避 + 可选抖动）
   *
   * @param {number} attempt - 当前重试次数
   * @param {Object} options - 选项
   * @returns {number} 延迟时间（毫秒）

---

## shouldRetryError(error, attempt, maxRetries, options =

```javascript
shouldRetryError(error, attempt, maxRetries, options =
```

* 判断错误是否应该重试
   *
   * @param {Error} error - 错误对象
   * @param {number} attempt - 当前重试次数
   * @param {number} maxRetries - 最大重试次数
   * @param {Object} options - 选项
   * @returns {boolean} 是否应该重试

---

## recordRetryByType(type)

```javascript
recordRetryByType(type)
```

* 记录按类型分类的重试次数
   *
   * @param {string} type - 操作类型

---

## sleep(ms)

```javascript
sleep(ms)
```

* 睡眠指定时间
   *
   * @param {number} ms - 毫秒数
   * @returns {Promise<void>}

---

## getStats()

```javascript
getStats()
```

* 获取重试统计信息
   *
   * @returns {Object} 统计信息

---

## resetStats()

```javascript
resetStats()
```

* 重置统计信息

---

## wrap(fn, defaultOptions =

```javascript
wrap(fn, defaultOptions =
```

* 创建带重试的函数包装器
   *
   * @param {Function} fn - 要包装的函数
   * @param {Object} defaultOptions - 默认重试选项
   * @returns {Function} 包装后的函数
   *
   * @example
   * const fetchWithRetry = retryManager.wrap(
   *   async (url) => await fetch(url),
   *   { operationName: 'fetch', maxRetries: 5 }
   * );
   * const data = await fetchWithRetry('https://api.example.com/data');

---

## const RETRY_STRATEGIES =

```javascript
const RETRY_STRATEGIES =
```

* 重试策略预设

---

