# file-cache

**Source**: `src/main/utils/file-cache.js`

**Generated**: 2026-02-21T22:04:25.765Z

---

## const

```javascript
const
```

* 文件处理缓存管理器
 * 实现LRU缓存策略，优化文件重复读取性能

---

## class LRUCache

```javascript
class LRUCache
```

* LRU缓存实现

---

## get(key)

```javascript
get(key)
```

* 获取缓存项

---

## set(key, value, size = 0)

```javascript
set(key, value, size = 0)
```

* 设置缓存项

---

## delete(key)

```javascript
delete(key)
```

* 删除缓存项

---

## evictOldest()

```javascript
evictOldest()
```

* 驱逐最旧的缓存项

---

## clear()

```javascript
clear()
```

* 清空缓存

---

## getStats()

```javascript
getStats()
```

* 获取缓存统计信息

---

## has(key)

```javascript
has(key)
```

* 检查是否包含key

---

## class FileCacheManager

```javascript
class FileCacheManager
```

* 文件缓存管理器

---

## async generateFileKey(filePath, options =

```javascript
async generateFileKey(filePath, options =
```

* 生成文件缓存key

---

## async cacheFileContent(filePath, content)

```javascript
async cacheFileContent(filePath, content)
```

* 缓存文件内容

---

## async getCachedFileContent(filePath)

```javascript
async getCachedFileContent(filePath)
```

* 获取缓存的文件内容

---

## async cacheFileMetadata(filePath, metadata)

```javascript
async cacheFileMetadata(filePath, metadata)
```

* 缓存文件元数据

---

## async getCachedFileMetadata(filePath)

```javascript
async getCachedFileMetadata(filePath)
```

* 获取缓存的文件元数据

---

## async cacheParseResult(filePath, parseType, result)

```javascript
async cacheParseResult(filePath, parseType, result)
```

* 缓存解析结果

---

## async getCachedParseResult(filePath, parseType)

```javascript
async getCachedParseResult(filePath, parseType)
```

* 获取缓存的解析结果

---

## async invalidateFile(filePath)

```javascript
async invalidateFile(filePath)
```

* 使缓存失效

---

## async invalidateFiles(filePaths)

```javascript
async invalidateFiles(filePaths)
```

* 批量使缓存失效

---

## clearAll()

```javascript
clearAll()
```

* 清空所有缓存

---

## getStats()

```javascript
getStats()
```

* 获取缓存统计信息

---

## printStats()

```javascript
printStats()
```

* 打印缓存统计

---

## watchFile(filePath, callback)

```javascript
watchFile(filePath, callback)
```

* 监听文件变化，自动使缓存失效

---

## function getFileCache(options)

```javascript
function getFileCache(options)
```

* 获取FileCacheManager单例

---

