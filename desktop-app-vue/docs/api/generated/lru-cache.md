# lru-cache

**Source**: `src\renderer\utils\lru-cache.js`

**Generated**: 2026-01-27T06:44:03.897Z

---

## export class LRUCache

```javascript
export class LRUCache
```

* LRU (Least Recently Used) Cache Implementation
 * 用于缓存文件元数据、文件类型检测结果等昂贵的计算

---

## constructor(capacity = 100, ttl = 5 * 60 * 1000)

```javascript
constructor(capacity = 100, ttl = 5 * 60 * 1000)
```

* @param {number} capacity - 缓存容量（最大条目数）
   * @param {number} ttl - 缓存过期时间（毫秒），默认5分钟

---

## get(key)

```javascript
get(key)
```

* 获取缓存值
   * @param {string} key - 缓存键
   * @returns {any} 缓存值，如果不存在或已过期则返回 undefined

---

## set(key, value)

```javascript
set(key, value)
```

* 设置缓存值
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值

---

## delete(key)

```javascript
delete(key)
```

* 删除缓存条目
   * @param {string} key - 缓存键

---

## clear()

```javascript
clear()
```

* 清空缓存

---

## size()

```javascript
size()
```

* 获取缓存大小
   * @returns {number}

---

## has(key)

```javascript
has(key)
```

* 检查键是否存在且未过期
   * @param {string} key - 缓存键
   * @returns {boolean}

---

## _updateAccessOrder(key)

```javascript
_updateAccessOrder(key)
```

* 更新访问顺序
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取缓存统计信息
   * @returns {Object}

---

## export class FileMetadataCache

```javascript
export class FileMetadataCache
```

* 文件元数据缓存管理器
 * 专门用于缓存文件类型检测、语法高亮配置等昂贵操作

---

## getFileType(filePath)

```javascript
getFileType(filePath)
```

* 获取文件类型信息
   * @param {string} filePath - 文件路径
   * @returns {Object|undefined}

---

## setFileType(filePath, typeInfo)

```javascript
setFileType(filePath, typeInfo)
```

* 设置文件类型信息
   * @param {string} filePath - 文件路径
   * @param {Object} typeInfo - 类型信息

---

## getFileStats(filePath)

```javascript
getFileStats(filePath)
```

* 获取文件统计信息
   * @param {string} filePath - 文件路径
   * @returns {Object|undefined}

---

## setFileStats(filePath, stats)

```javascript
setFileStats(filePath, stats)
```

* 设置文件统计信息
   * @param {string} filePath - 文件路径
   * @param {Object} stats - 统计信息

---

## getSyntaxConfig(language)

```javascript
getSyntaxConfig(language)
```

* 获取语法高亮配置
   * @param {string} language - 语言类型
   * @returns {Object|undefined}

---

## setSyntaxConfig(language, config)

```javascript
setSyntaxConfig(language, config)
```

* 设置语法高亮配置
   * @param {string} language - 语言类型
   * @param {Object} config - 配置信息

---

## getOCRResult(imageHash)

```javascript
getOCRResult(imageHash)
```

* 获取OCR结果
   * @param {string} imageHash - 图片哈希
   * @returns {string|undefined}

---

## setOCRResult(imageHash, text)

```javascript
setOCRResult(imageHash, text)
```

* 设置OCR结果
   * @param {string} imageHash - 图片哈希
   * @param {string} text - OCR识别文本

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
   * @returns {Object}

---

