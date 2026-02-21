# database-concurrency

**Source**: `src/main/utils/database-concurrency.js`

**Generated**: 2026-02-21T20:04:16.189Z

---

## const

```javascript
const
```

* 数据库并发控制工具
 * 处理并发写入冲突、死锁和重试逻辑

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 并发控制配置

---

## const ERROR_TYPES =

```javascript
const ERROR_TYPES =
```

* 错误类型

---

## class DatabaseConcurrencyController extends EventEmitter

```javascript
class DatabaseConcurrencyController extends EventEmitter
```

* 并发控制器

---

## async executeWithRetry(operation, options =

```javascript
async executeWithRetry(operation, options =
```

* 执行数据库操作（带重试）
   * @param {Function} operation - 数据库操作函数
   * @param {Object} options - 选项
   * @returns {Promise<any>} 操作结果

---

## async executeTransaction(db, callback, options =

```javascript
async executeTransaction(db, callback, options =
```

* 执行事务（带重试和冲突处理）
   * @param {Object} db - 数据库实例
   * @param {Function} callback - 事务回调
   * @param {Object} options - 选项

---

## async queueWrite(writeOperation, options =

```javascript
async queueWrite(writeOperation, options =
```

* 队列化写入操作
   * @param {Function} writeOperation - 写入操作
   * @param {Object} options - 选项

---

## async _processQueue()

```javascript
async _processQueue()
```

* 处理写入队列

---

## _identifyErrorType(error)

```javascript
_identifyErrorType(error)
```

* 识别错误类型
   * @param {Error} error - 错误对象
   * @returns {string} 错误类型

---

## _recordErrorStatistics(errorType)

```javascript
_recordErrorStatistics(errorType)
```

* 记录错误统计

---

## _shouldRetry(errorType, attempt, maxRetries)

```javascript
_shouldRetry(errorType, attempt, maxRetries)
```

* 判断是否应该重试
   * @param {string} errorType - 错误类型
   * @param {number} attempt - 当前尝试次数
   * @param {number} maxRetries - 最大重试次数
   * @returns {boolean}

---

## _calculateRetryDelay(attempt)

```javascript
_calculateRetryDelay(attempt)
```

* 计算重试延迟
   * @param {number} attempt - 尝试次数
   * @returns {number} 延迟时间（毫秒）

---

## _sleep(ms)

```javascript
_sleep(ms)
```

* 睡眠函数

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计信息

---

## resetStatistics()

```javascript
resetStatistics()
```

* 重置统计信息

---

## let globalController = null;

```javascript
let globalController = null;
```

* 全局实例

---

## function getConcurrencyController(config)

```javascript
function getConcurrencyController(config)
```

* 获取全局并发控制器

---

## async function withRetry(operation, options =

```javascript
async function withRetry(operation, options =
```

* 便捷函数：执行带重试的操作

---

## async function queueWrite(operation, options =

```javascript
async function queueWrite(operation, options =
```

* 便捷函数：队列化写入

---

