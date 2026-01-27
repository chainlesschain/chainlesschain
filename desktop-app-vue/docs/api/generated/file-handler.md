# file-handler

**Source**: `src\main\utils\file-handler.js`

**Generated**: 2026-01-27T06:44:03.791Z

---

## const

```javascript
const
```

* 文件处理工具模块 - 大文件性能优化
 * 提供流式处理、分块读写、内存管理等功能

---

## async isLargeFile(filePath)

```javascript
async isLargeFile(filePath)
```

* 检查是否为大文件

---

## async getFileSize(filePath)

```javascript
async getFileSize(filePath)
```

* 获取文件大小

---

## checkAvailableMemory()

```javascript
checkAvailableMemory()
```

* 检查可用内存

---

## async readFileStream(filePath, onChunk, options =

```javascript
async readFileStream(filePath, onChunk, options =
```

* 流式读取文件
   * @param {string} filePath - 文件路径
   * @param {Function} onChunk - 处理每个chunk的回调函数
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 读取结果

---

## async writeFileStream(filePath, dataSource, options =

```javascript
async writeFileStream(filePath, dataSource, options =
```

* 流式写入文件
   * @param {string} filePath - 文件路径
   * @param {AsyncIterable|Array} dataSource - 数据源（支持异步迭代器或数组）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 写入结果

---

## async copyLargeFile(sourcePath, destPath, options =

```javascript
async copyLargeFile(sourcePath, destPath, options =
```

* 复制大文件（使用流）

---

## async processInChunks(filePath, processor, options =

```javascript
async processInChunks(filePath, processor, options =
```

* 分块处理文件
   * @param {string} filePath - 文件路径
   * @param {Function} processor - 处理函数
   * @param {Object} options - 选项

---

## async processBatch(files, processor, options =

```javascript
async processBatch(files, processor, options =
```

* 批量处理文件（带并发控制）

---

## async processWithRetry(file, processor, options =

```javascript
async processWithRetry(file, processor, options =
```

* 带重试的处理

---

## async waitForMemory(timeout = 5000)

```javascript
async waitForMemory(timeout = 5000)
```

* 等待内存释放

---

## createTransformStream(transformFn)

```javascript
createTransformStream(transformFn)
```

* 创建Transform流处理器

---

## getStats()

```javascript
getStats()
```

* 获取文件处理统计信息

---

## function getFileHandler(options)

```javascript
function getFileHandler(options)
```

* 获取FileHandler单例

---

