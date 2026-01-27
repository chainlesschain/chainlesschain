# retry-policy

**Source**: `src\main\sync\retry-policy.js`

**Generated**: 2026-01-27T06:44:03.803Z

---

## class RetryPolicy

```javascript
class RetryPolicy
```

* 指数退避重试策略
 * 用于处理网络请求失败的重试逻辑

---

## constructor(

```javascript
constructor(
```

* @param {number} maxRetries - 最大重试次数（默认6次）
   * @param {number} baseDelay - 基础延迟时间（毫秒，默认100ms）
   * @param {number} maxDelay - 最大延迟时间（毫秒，默认30000ms = 30秒）
   * @param {number} jitterFactor - 抖动因子（0-1，默认0.3 = 30%随机抖动）

---

## async executeWithRetry(fn, context = '操作', options =

```javascript
async executeWithRetry(fn, context = '操作', options =
```

* 执行带重试的异步操作
   * @param {Function} fn - 要执行的异步函数
   * @param {string} context - 上下文描述（用于日志）
   * @param {Object} options - 可选配置
   * @returns {Promise<any>} 操作结果

---

## _calculateDelay(attempt)

```javascript
_calculateDelay(attempt)
```

* 计算延迟时间（指数退避 + 随机抖动）
   * @param {number} attempt - 当前重试次数（从0开始）
   * @returns {number} 延迟时间（毫秒）

---

## _defaultShouldRetry(error, attempt)

```javascript
_defaultShouldRetry(error, attempt)
```

* 默认的重试判断逻辑
   * @param {Error} error - 错误对象
   * @param {number} attempt - 当前重试次数
   * @returns {boolean} 是否应该重试

---

## _sleep(ms)

```javascript
_sleep(ms)
```

* 休眠指定毫秒数
   * @param {number} ms - 毫秒数
   * @returns {Promise<void>}

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计数据

---

## resetStats()

```javascript
resetStats()
```

* 重置统计信息

---

## async retry(fn, context)

```javascript
async retry(fn, context)
```

* 创建一个简化的重试函数（快捷方式）
   * @param {Function} fn - 要执行的异步函数
   * @param {string} context - 上下文描述
   * @returns {Promise<any>}

---

