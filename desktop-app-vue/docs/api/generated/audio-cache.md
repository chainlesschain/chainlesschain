# audio-cache

**Source**: `src/main/speech/audio-cache.js`

**Generated**: 2026-02-16T22:06:51.424Z

---

## const

```javascript
const
```

* 音频转录缓存管理器
 *
 * 避免重复转录相同的音频文件
 * 使用MD5哈希作为缓存键

---

## async initialize()

```javascript
async initialize()
```

* 初始化缓存目录

---

## async calculateHash(input)

```javascript
async calculateHash(input)
```

* 计算文件MD5哈希（流式处理，降低内存占用）
   * @param {string|Buffer} input - 文件路径或Buffer
   * @returns {Promise<string>} MD5哈希

---

## async generateCacheKey(input, params =

```javascript
async generateCacheKey(input, params =
```

* 生成增强缓存键（包含转录参数）
   * 修复：相同文件不同引擎/语言会误命中
   * @param {string|Buffer} input - 文件路径或Buffer
   * @param {Object} params - 转录参数
   * @param {string} params.engine - 转录引擎 (whisper, azure, etc.)
   * @param {string} params.language - 语言代码
   * @param {string} params.model - 模型名称
   * @returns {Promise<string>} 增强缓存键

---

## async has(hash)

```javascript
async has(hash)
```

* 检查缓存是否存在
   * @param {string} hash - 文件哈希
   * @returns {Promise<boolean>}

---

## async get(hash, params = null)

```javascript
async get(hash, params = null)
```

* 获取缓存（支持新缓存键格式，向后兼容旧格式）
   * @param {string} hash - 文件哈希或缓存键
   * @param {Object} params - 转录参数（可选，用于生成新格式缓存键）
   * @returns {Promise<Object|null>} 缓存的转录结果

---

## async set(hash, result, params = null)

```javascript
async set(hash, result, params = null)
```

* 保存缓存（使用异步写入队列）
   * @param {string} hash - 文件哈希或文件路径
   * @param {Object} result - 转录结果
   * @param {Object} params - 转录参数（可选，用于生成新格式缓存键）
   * @returns {Promise<void>}

---

## async delete(hash)

```javascript
async delete(hash)
```

* 删除缓存
   * @param {string} hash - 文件哈希
   * @returns {Promise<void>}

---

## async cleanup()

```javascript
async cleanup()
```

* 清理过期缓存
   * @returns {Promise<number>} 清理的文件数

---

## evictMemoryCache()

```javascript
evictMemoryCache()
```

* 内存缓存驱逐策略 (LRU - 按条目数限制)

---

## evictMemoryCacheBySize()

```javascript
evictMemoryCacheBySize()
```

* 按大小驱逐内存缓存（LRU策略）
   * 当总内存使用量超过限制时触发

---

## async processWriteQueue()

```javascript
async processWriteQueue()
```

* 异步处理写入队列
   * 批量写入缓存到磁盘，避免同步阻塞

---

## getCachePath(hash)

```javascript
getCachePath(hash)
```

* 获取缓存文件路径
   * @param {string} hash - 文件哈希
   * @returns {string}

---

## async getStats()

```javascript
async getStats()
```

* 获取缓存统计
   * @returns {Promise<Object>}

---

## async clear()

```javascript
async clear()
```

* 清空所有缓存
   * @returns {Promise<void>}

---

