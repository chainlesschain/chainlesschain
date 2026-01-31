# file-utils

**Source**: `src\renderer\utils\file-utils.js`

**Generated**: 2026-01-27T06:44:03.900Z

---

## import

```javascript
import
```

* 文件操作工具函数

---

## export function sanitizePath(basePath, relativePath)

```javascript
export function sanitizePath(basePath, relativePath)
```

* 安全地拼接文件路径，防止路径遍历攻击
 * @param {string} basePath - 基础路径（项目根路径）
 * @param {string} relativePath - 相对路径
 * @returns {string} 安全的完整路径
 * @throws {Error} 如果路径不安全

---

## export const FILE_SIZE_LIMITS =

```javascript
export const FILE_SIZE_LIMITS =
```

* 文件大小限制（字节）

---

## export function getFileSizeLimit(extension)

```javascript
export function getFileSizeLimit(extension)
```

* 获取文件类型对应的大小限制
 * @param {string} extension - 文件扩展名
 * @returns {number} 字节数

---

## export function formatFileSize(bytes)

```javascript
export function formatFileSize(bytes)
```

* 格式化文件大小为人类可读格式
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小

---

## export function validateFileSize(fileSize, extension)

```javascript
export function validateFileSize(fileSize, extension)
```

* 检查文件大小是否超过限制
 * @param {number} fileSize - 文件大小（字节）
 * @param {string} extension - 文件扩展名
 * @returns {Object} { isValid: boolean, limit: number, message: string }

---

## export function throttle(func, wait = 16)

```javascript
export function throttle(func, wait = 16)
```

* 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 节流后的函数

---

## export function debounce(func, wait = 300)

```javascript
export function debounce(func, wait = 300)
```

* 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数

---

## export function getFileTypeInfo(filePath, fileName)

```javascript
export function getFileTypeInfo(filePath, fileName)
```

* 获取文件类型信息（带缓存优化）
 * @param {string} filePath - 文件路径
 * @param {string} fileName - 文件名
 * @returns {Object} 文件类型信息

---

## export function getCacheStats()

```javascript
export function getCacheStats()
```

* 获取缓存统计信息
 * @returns {Object}

---

## export function clearFileTypeCache()

```javascript
export function clearFileTypeCache()
```

* 清空文件类型缓存

---

