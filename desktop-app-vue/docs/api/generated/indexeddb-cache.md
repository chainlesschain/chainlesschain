# indexeddb-cache

**Source**: `src\renderer\utils\indexeddb-cache.js`

**Generated**: 2026-01-27T06:44:03.898Z

---

## const DB_NAME = 'ChainlessChainCache';

```javascript
const DB_NAME = 'ChainlessChainCache';
```

* IndexedDB Cache Manager
 * 用于缓存文件内容、解析结果等大数据，支持离线访问

---

## class IndexedDBWrapper

```javascript
class IndexedDBWrapper
```

* IndexedDB包装器

---

## async init()

```javascript
async init()
```

* 初始化数据库
   * @returns {Promise<IDBDatabase>}

---

## async getStore(storeName, mode = 'readonly')

```javascript
async getStore(storeName, mode = 'readonly')
```

* 获取对象存储
   * @param {string} storeName - 存储名称
   * @param {string} mode - 访问模式 ('readonly' | 'readwrite')
   * @returns {Promise<IDBObjectStore>}

---

## async put(storeName, data)

```javascript
async put(storeName, data)
```

* 添加或更新数据
   * @param {string} storeName - 存储名称
   * @param {Object} data - 数据对象
   * @returns {Promise<any>}

---

## async get(storeName, key)

```javascript
async get(storeName, key)
```

* 获取数据
   * @param {string} storeName - 存储名称
   * @param {string} key - 键
   * @returns {Promise<any>}

---

## async delete(storeName, key)

```javascript
async delete(storeName, key)
```

* 删除数据
   * @param {string} storeName - 存储名称
   * @param {string} key - 键
   * @returns {Promise<void>}

---

## async getByIndex(storeName, indexName, value)

```javascript
async getByIndex(storeName, indexName, value)
```

* 通过索引查询数据
   * @param {string} storeName - 存储名称
   * @param {string} indexName - 索引名称
   * @param {any} value - 索引值
   * @returns {Promise<Array>}

---

## async clear(storeName)

```javascript
async clear(storeName)
```

* 清空存储
   * @param {string} storeName - 存储名称
   * @returns {Promise<void>}

---

## async getAll(storeName)

```javascript
async getAll(storeName)
```

* 获取所有数据
   * @param {string} storeName - 存储名称
   * @returns {Promise<Array>}

---

## close()

```javascript
close()
```

* 关闭数据库

---

## export class FileCacheManager

```javascript
export class FileCacheManager
```

* 文件缓存管理器

---

## generateKey(projectId, filePath)

```javascript
generateKey(projectId, filePath)
```

* 生成缓存键
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @returns {string}

---

## async cacheFileContent(projectId, filePath, content, metadata =

```javascript
async cacheFileContent(projectId, filePath, content, metadata =
```

* 缓存文件内容
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @param {Object} metadata - 元数据
   * @returns {Promise<void>}

---

## async getCachedFileContent(projectId, filePath)

```javascript
async getCachedFileContent(projectId, filePath)
```

* 获取缓存的文件内容
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object|null>}

---

## async cacheParseResult(fileId, fileType, result)

```javascript
async cacheParseResult(fileId, fileType, result)
```

* 缓存解析结果
   * @param {string} fileId - 文件ID
   * @param {string} fileType - 文件类型
   * @param {Object} result - 解析结果
   * @returns {Promise<void>}

---

## async getCachedParseResult(fileId, fileType)

```javascript
async getCachedParseResult(fileId, fileType)
```

* 获取缓存的解析结果
   * @param {string} fileId - 文件ID
   * @param {string} fileType - 文件类型
   * @returns {Promise<Object|null>}

---

## async cacheSyntaxResult(fileId, language, result)

```javascript
async cacheSyntaxResult(fileId, language, result)
```

* 缓存语法高亮结果
   * @param {string} fileId - 文件ID
   * @param {string} language - 语言类型
   * @param {Object} result - 高亮结果
   * @returns {Promise<void>}

---

## async getCachedSyntaxResult(fileId, language)

```javascript
async getCachedSyntaxResult(fileId, language)
```

* 获取缓存的语法高亮结果
   * @param {string} fileId - 文件ID
   * @param {string} language - 语言类型
   * @returns {Promise<Object|null>}

---

## async clearProjectCache(projectId)

```javascript
async clearProjectCache(projectId)
```

* 删除项目的所有缓存
   * @param {string} projectId - 项目ID
   * @returns {Promise<void>}

---

## async checkCacheSize()

```javascript
async checkCacheSize()
```

* 检查并清理缓存大小
   * @returns {Promise<void>}

---

## async getStats()

```javascript
async getStats()
```

* 获取缓存统计信息
   * @returns {Promise<Object>}

---

## formatSize(bytes)

```javascript
formatSize(bytes)
```

* 格式化大小
   * @param {number} bytes - 字节数
   * @returns {string}

---

## async clearAll()

```javascript
async clearAll()
```

* 清空所有缓存
   * @returns {Promise<void>}

---

## close()

```javascript
close()
```

* 关闭数据库

---

