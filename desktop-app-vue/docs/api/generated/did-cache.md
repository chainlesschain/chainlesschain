# did-cache

**Source**: `src/main/did/did-cache.js`

**Generated**: 2026-02-21T22:45:05.302Z

---

## const

```javascript
const
```

* DID 缓存管理器
 *
 * 提供DID文档的本地缓存功能，减少DHT网络请求，提升解析性能
 *
 * 功能:
 * - LRU缓存策略
 * - TTL过期机制
 * - 缓存统计
 * - 持久化支持

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* DID缓存配置

---

## class DIDCache extends EventEmitter

```javascript
class DIDCache extends EventEmitter
```

* DID缓存类

---

## async initialize()

```javascript
async initialize()
```

* 初始化缓存

---

## async ensureCacheTable()

```javascript
async ensureCacheTable()
```

* 确保缓存表存在

---

## async loadFromDatabase()

```javascript
async loadFromDatabase()
```

* 从数据库加载缓存

---

## async get(did)

```javascript
async get(did)
```

* 获取缓存的DID文档
   * @param {string} did - DID标识符
   * @returns {Object|null} DID文档或null

---

## async set(did, document)

```javascript
async set(did, document)
```

* 设置缓存
   * @param {string} did - DID标识符
   * @param {Object} document - DID文档

---

## async clear(did)

```javascript
async clear(did)
```

* 清除缓存
   * @param {string} did - DID标识符 (可选，不传则清除所有)

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计信息

---

## resetStats()

```javascript
resetStats()
```

* 重置统计信息

---

## estimateMemoryUsage()

```javascript
estimateMemoryUsage()
```

* 估算内存使用量 (字节)

---

## startCleanup()

```javascript
startCleanup()
```

* 启动定期清理

---

## stopCleanup()

```javascript
stopCleanup()
```

* 停止定期清理

---

## async cleanup()

```javascript
async cleanup()
```

* 清理过期缓存

---

## async saveToDatabase(did, document, cachedAt, expiresAt)

```javascript
async saveToDatabase(did, document, cachedAt, expiresAt)
```

* 保存到数据库

---

## async deleteFromDatabase(did)

```javascript
async deleteFromDatabase(did)
```

* 从数据库删除

---

## async updateAccessInDatabase(did, accessCount, lastAccessedAt)

```javascript
async updateAccessInDatabase(did, accessCount, lastAccessedAt)
```

* 更新数据库访问记录

---

## async destroy()

```javascript
async destroy()
```

* 销毁缓存管理器

---

