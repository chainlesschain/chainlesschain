# large-file-reader

**Source**: `src/main/file/large-file-reader.js`

**Generated**: 2026-02-15T08:42:37.240Z

---

## const

```javascript
const
```

* 大文件读取器
 * 支持分块读取、流式搜索，避免将整个文件加载到内存

---

## async getFileSize(filePath)

```javascript
async getFileSize(filePath)
```

* 获取文件大小
   * @param {string} filePath - 文件路径
   * @returns {Promise<number>} 文件大小（字节）

---

## async readChunk(filePath, offset, size)

```javascript
async readChunk(filePath, offset, size)
```

* 读取文件块（按字节）
   * @param {string} filePath - 文件路径
   * @param {number} offset - 起始偏移量
   * @param {number} size - 读取大小
   * @returns {Promise<Buffer>} 文件块内容

---

## async readLines(filePath, startLine, lineCount)

```javascript
async readLines(filePath, startLine, lineCount)
```

* 读取文件行（按行数）
   * @param {string} filePath - 文件路径
   * @param {number} startLine - 起始行号（0-based）
   * @param {number} lineCount - 读取行数
   * @returns {Promise<Object>} 包含lines数组和hasMore标志

---

## async countLines(filePath)

```javascript
async countLines(filePath)
```

* 计算文件总行数
   * @param {string} filePath - 文件路径
   * @returns {Promise<number>} 总行数

---

## async searchInFile(filePath, query, options =

```javascript
async searchInFile(filePath, query, options =
```

* 在文件中搜索（流式搜索，不加载全文件）
   * @param {string} filePath - 文件路径
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 搜索结果

---

## async getFileHead(filePath, lineCount = 100)

```javascript
async getFileHead(filePath, lineCount = 100)
```

* 获取文件的前N行（用于预览）
   * @param {string} filePath - 文件路径
   * @param {number} lineCount - 行数
   * @returns {Promise<Array>} 文件行

---

## async getFileTail(filePath, lineCount = 100)

```javascript
async getFileTail(filePath, lineCount = 100)
```

* 获取文件的后N行
   * @param {string} filePath - 文件路径
   * @param {number} lineCount - 行数
   * @returns {Promise<Array>} 文件行

---

## async getFileInfo(filePath)

```javascript
async getFileInfo(filePath)
```

* 获取文件元信息
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 文件信息

---

## async streamFile(filePath, onChunk, options =

```javascript
async streamFile(filePath, onChunk, options =
```

* 流式读取文件（用于下载或传输）
   * @param {string} filePath - 文件路径
   * @param {Function} onChunk - 每块数据的回调
   * @param {Object} options - 选项

---

